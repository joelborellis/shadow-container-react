"use client";

import { useState, useRef, useEffect } from "react";
import { marked } from "marked";
import Image from "next/image";

interface Message {
  id: string;
  content: string;
  type: 'user' | 'assistant';
  timestamp: Date;
  functionCalls?: FunctionCall[];
  isStreaming?: boolean;
  responseTime?: number; // in milliseconds
}

interface FunctionCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  timestamp: Date;
}

export default function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      content: 'Hello and welcome to Shadow! How can I help you today?',
      type: 'assistant',
      timestamp: new Date()
    }
  ]);  
  const [inputValue, setInputValue] = useState('');
  const [demandPhase, setDemandPhase] = useState('Pre-Demand');
  const [accountName, setAccountName] = useState('');
  const [accountId, setAccountId] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientId, setClientId] = useState('');
  const [pursuitId, setPursuitId] = useState('');  
  const [additionalInstructions, setAdditionalInstructions] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [threadId, setThreadId] = useState('');
  const [isConfigExpanded, setIsConfigExpanded] = useState(false);

  // Auto-scroll refs
  const containerRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Scroll to bottom whenever messages change (including streaming updates)
  useEffect(() => {
    // If a sentinel exists, scroll it into view. Use smooth behavior for nicer UX.
    if (messagesEndRef.current) {
      try {
        messagesEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } catch (e) {
        // fallback to instant scroll if smooth is not supported
        messagesEndRef.current.scrollIntoView();
      }
    }
  }, [messages]);

  const handleNewChat = () => {
    // Clear all messages except welcome message
    setMessages([{
      id: '1',
      content: 'Hello and welcome to Shadow! How can I help you today?',
      type: 'assistant',
      timestamp: new Date()
    }]);
    // Clear all input fields
    setInputValue('');
    setDemandPhase('Pre-Demand');
    setAccountName('');
    setAccountId('');
    setClientName('');
    setClientId('');
    setPursuitId('');    
    setAdditionalInstructions('');
    setThreadId('');
    setIsLoading(false);
    setIsConfigExpanded(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim()) return;

    // Collapse configuration settings when sending a message
    setIsConfigExpanded(false);

    // Add user message
    const userMessage: Message = {
      id: Date.now().toString(),
      content: inputValue,
      type: 'user',
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    const currentQuery = inputValue;
    setInputValue('');
    setIsLoading(true);

    // Create assistant message for streaming
    const assistantMessageId = (Date.now() + 1).toString();
    const assistantMessage: Message = {
      id: assistantMessageId,
      content: '',
      type: 'assistant',
      timestamp: new Date(),
      functionCalls: [],
      isStreaming: true
    };

    setMessages(prev => [...prev, assistantMessage]);

    try {
      // Record start time for response time measurement
      const startTime = performance.now();      
      // Prepare request body
      const requestBody = {
        query: currentQuery,
        threadId: threadId,
        demand_stage: demandPhase,
        AccountName: accountName,
        AccountId: accountId,
        ClientName: clientName,
        ClientId: clientId,
        PursuitId: pursuitId,
        additional_instructions: additionalInstructions
      };

      // Call the backend API with SSE
      //const response = await fetch('http://localhost:8000/shadow-sk', {
      const response = await fetch('https://shadow-container-app.nicebeach-c4679607.eastus.azurecontainerapps.io/shadow-sk', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder('utf-8');

      if (!reader) {
        throw new Error('Failed to get response reader');
      }

      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;

        // Decode immediately without buffering
        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;
        
        // Process complete lines immediately
        let newlineIndex;
        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
          const line = buffer.substring(0, newlineIndex).trim();
          buffer = buffer.substring(newlineIndex + 1);
          
          // Skip empty lines
          if (!line) continue;
          
          // Process event lines
          if (line.startsWith('event:')) {
            // Event type - we can use this for debugging if needed
            continue;
          }
          
          // Process data lines immediately
          if (line.startsWith('data:')) {
            const dataStr = line.substring(5).trim();
            if (!dataStr) continue;

            try {
              const data = JSON.parse(dataStr);
              
              // Process immediately without batching
              setMessages(prev => prev.map(msg => {
                if (msg.id !== assistantMessageId) return msg;

                const updatedMsg = { ...msg };                
                switch (data.type) {
                  case 'function_call':
                    const newFunctionCall: FunctionCall = {
                      id: `${data.function_name}-${Date.now()}`,
                      name: data.function_name,
                      arguments: data.arguments,
                      timestamp: new Date()
                    };
                    updatedMsg.functionCalls = [...(updatedMsg.functionCalls || []), newFunctionCall];
                    break;

                  case 'function_result':
                    updatedMsg.functionCalls = (updatedMsg.functionCalls || []).map(fc => 
                      fc.name === data.function_name && !fc.result 
                        ? { ...fc, result: data.result }
                        : fc
                    );
                    break;

                  case 'thread_info':
                    // Handle thread info event - update thread ID for future requests
                    if (data.thread_id) {
                      setThreadId(data.thread_id);
                    }
                    break;

                  case 'content':
                    updatedMsg.content += data.content;
                    break;

                  case 'intermediate':
                    // Handle intermediate messages if needed
                    break;

                  case 'stream_complete':
                    const endTime = performance.now();
                    const responseTime = Math.round(endTime - startTime);
                    updatedMsg.isStreaming = false;
                    updatedMsg.responseTime = responseTime;
                    break;

                  case 'error':
                    updatedMsg.content = `Error: ${data.error}`;
                    updatedMsg.isStreaming = false;
                    break;
                }

                return updatedMsg;
              }));

            } catch (parseError) {
              console.error('Failed to parse SSE data:', parseError, 'Raw data:', dataStr);
            }
          }
        }
      }

    } catch (error) {
      console.error('Error calling API:', error);
      
      // Update the assistant message with error
      setMessages(prev => prev.map(msg => 
        msg.id === assistantMessageId 
          ? { 
              ...msg, 
              content: `Sorry, I encountered an error: ${error instanceof Error ? error.message : 'Unknown error'}`,
              isStreaming: false
            }
          : msg
      ));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <style>{`
        .shadow-markdown {
          font-size: 1.05rem;
          line-height: 1.7;
          color: #334155;
          word-break: break-word;
        }
        .dark .shadow-markdown {
          color: #e0e7ef;
        }
        .shadow-markdown h1, .shadow-markdown h2, .shadow-markdown h3, .shadow-markdown h4, .shadow-markdown h5, .shadow-markdown h6 {
          margin-top: 1.2em;
          margin-bottom: 0.5em;
          font-weight: 700;
          line-height: 1.2;
        }
        .shadow-markdown h1 {
          font-size: 2.1rem;
        }
        .shadow-markdown h2 {
          font-size: 1.5rem;
        }
        .shadow-markdown h3 {
          font-size: 1.15rem;
        }
        .shadow-markdown p {
          margin: 0.7em 0;
        }
        .shadow-markdown ul, .shadow-markdown ol {
          margin: 0.7em 0 0.7em 2em;
          padding: 0;
        }
        .shadow-markdown li {
          margin-bottom: 0.3em;
        }
        .shadow-markdown strong {
          font-weight: 600;
        }
        .shadow-markdown pre, .shadow-markdown code {
          font-family: 'Fira Mono', 'Consolas', 'Menlo', monospace;
        }
        .shadow-markdown pre {
          background: #f1f5f9;
          color: #334155;
          border-radius: 0.5em;
          padding: 1em;
          overflow-x: auto;
          margin-bottom: 1.2em;
        }
        .dark .shadow-markdown pre {
          background: #1e293b;
          color: #e0e7ef;
        }
        .shadow-markdown code {
          background: #e2e8f0;
          color: #334155;
          border-radius: 0.3em;
          padding: 0.2em 0.4em;
          font-size: 0.97em;
        }
        .dark .shadow-markdown code {
          background: #334155;
          color: #e0e7ef;
        }
        .shadow-markdown table {
          border-collapse: collapse;
          width: 100%;
          margin: 1.2em 0;
        }
        .shadow-markdown th, .shadow-markdown td {
          border: 1px solid #cbd5e1;
          padding: 0.5em 0.8em;
        }
        .shadow-markdown th {
          background: #f1f5f9;
          font-weight: 600;
        }
        .dark .shadow-markdown th {
          background: #1e293b;
        }
        .shadow-markdown tr:nth-child(even) td {
          background: #f8fafc;
        }
        .dark .shadow-markdown tr:nth-child(even) td {
          background: #273549;
        }
        .shadow-markdown blockquote {
          border-left: 4px solid #60a5fa;
          background: #f1f5f9;
          color: #334155;
          padding: 0.7em 1em;
          margin: 1em 0;
          border-radius: 0.3em;
        }
        .dark .shadow-markdown blockquote {
          background: #1e293b;
          color: #e0e7ef;
        }
        .shadow-markdown hr {
          border: none;
          border-top: 1px solid #cbd5e1;
          margin: 2em 0;
        }
        .shadow-markdown body {
          margin: 0;
        }
        .shadow-markdown {
          /* Remove extra spaces from html body */
        }
        .shadow-markdown > *:first-child {
          margin-top: 0;
        }
        .shadow-markdown > *:last-child {
          margin-bottom: 0;
        }
      `}</style>
      <div className="flex flex-col h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900">
      {/* Header */}
      <header className="border-b border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-200 to-indigo-300 rounded-xl flex items-center justify-center shadow-lg">
                <Image
                  src="/Shadow-trans.png"
                  alt="AI Assistant"
                  width={40}
                  height={40}
                  className="dark:invert"
                />
              </div>
              <div>
                <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-200">
                  Shadow Assistant
                </h1>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Your intelligent chat companion
                </p>
              </div>
            </div>
            
            {/* New Chat Button */}
            <button
              onClick={handleNewChat}
              disabled={isLoading}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-emerald-500 to-blue-600 hover:from-emerald-600 hover:to-blue-700 disabled:from-slate-300 disabled:to-slate-400 dark:disabled:from-slate-600 dark:disabled:to-slate-700 text-white rounded-xl font-medium text-sm transition-all duration-200 shadow-lg disabled:cursor-not-allowed"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-white"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
              <span>New Chat</span>
            </button>
          </div>
        </div>
      </header>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto" ref={containerRef}>
  <div className="max-w-6xl mx-auto px-4 py-6">
          <div className="space-y-6">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex gap-4 ${
                  message.type === 'user' ? 'justify-end' : 'justify-start'
                }`}
              >
                {message.type === 'assistant' && (
                  <div className="w-10 h-10 bg-gradient-to-br from-emerald-200 to-blue-300 rounded-xl flex items-center justify-center shadow-lg flex-shrink-0">
                    <Image
                      src="/Shadow-trans.png"
                      alt="Assistant"
                      width={40}
                      height={40}
                      className="dark:invert"
                    />
                  </div>
                )}
                
                <div
                  className={`rounded-2xl px-4 py-3 shadow-lg ${
                    message.type === 'user'
                      ? 'max-w-[70%] bg-gradient-to-r from-blue-500 to-indigo-600 text-white'
                      : 'max-w-[85%] bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700'
                  }`}
                >                  
                  {/* Function Calls */}
                  {message.functionCalls && message.functionCalls.length > 0 && (
                    <div className="mb-3 space-y-2">
                      {message.functionCalls.map((fc) => (
                        <div key={fc.id} className="bg-slate-50 dark:bg-slate-700/50 rounded-lg p-3 border-l-4 border-emerald-500">
                          <div className="flex items-center gap-2 mb-2">
                            <div className="w-2 h-2 bg-emerald-500 rounded-full"></div>
                            <span className="font-mono text-sm font-medium text-emerald-700 dark:text-emerald-400">
                              {fc.name}()
                            </span>
                            <span className="text-xs text-slate-500 dark:text-slate-400">
                              {fc.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </span>
                          </div>
                          
                          {/* Function Arguments */}
                          {fc.arguments && Object.keys(fc.arguments).length > 0 && (
                            <div className="mb-2">
                              <div className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Arguments:</div>
                              <div className="bg-slate-100 dark:bg-slate-600 rounded p-2 text-xs font-mono overflow-x-auto">
                                <pre className="text-slate-700 dark:text-slate-300">
                                  {JSON.stringify(fc.arguments, null, 2)}
                                </pre>
                              </div>
                            </div>
                          )}

                          {/* Function Result */}
                          {fc.result !== undefined && (
                            <div>
                              <div className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Result:</div>
                              <div className="bg-slate-100 dark:bg-slate-600 rounded p-2 text-xs font-mono overflow-x-auto max-h-32 overflow-y-auto">
                                <pre className="text-slate-700 dark:text-slate-300">
                                  {typeof fc.result === 'string' ? fc.result : JSON.stringify(fc.result, null, 2)}
                                </pre>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Message Content */}
                  {message.content && (
                    <div className="text-sm leading-relaxed">
                      {message.type === 'assistant' ? (
                        <div
                          className="shadow-markdown prose prose-slate dark:prose-invert max-w-none text-[1rem]"
                          dangerouslySetInnerHTML={{
                            __html: (() => {
                              let html = message.content.trim();
                              if (html.startsWith('```html')) {
                                html = html.replace(/^```html\s*/, '');
                              }
                              if (html.endsWith('```')) {
                                html = html.replace(/```\s*$/, '');
                              }
                              return html.trim();
                            })()
                          }}
                        />
                      ) : (
                        <div className="whitespace-pre-wrap text-[1rem]">{message.content}</div>
                      )}
                      {message.isStreaming && (
                        <div className="flex items-center gap-2 mt-3 p-2 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-slate-700 dark:to-slate-600 rounded-lg">
                          {/* Sales Chart Animation */}
                          <div className="flex items-end gap-1">
                            <div className="w-2 h-2 bg-emerald-500 rounded-sm animate-pulse" style={{ animationDelay: '0s' }}></div>
                            <div className="w-2 h-3 bg-emerald-500 rounded-sm animate-pulse" style={{ animationDelay: '0.2s' }}></div>
                            <div className="w-2 h-4 bg-emerald-500 rounded-sm animate-pulse" style={{ animationDelay: '0.4s' }}></div>
                            <div className="w-2 h-5 bg-emerald-500 rounded-sm animate-pulse" style={{ animationDelay: '0.6s' }}></div>
                          </div>
                          
                          {/* Dollar Sign Animation */}
                          <div className="text-emerald-600 dark:text-emerald-400 animate-bounce">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1.41 16.09V20h-2.67v-1.93c-1.71-.36-3.16-1.46-3.27-3.4h1.96c.1 1.05.82 1.87 2.65 1.87 1.96 0 2.4-.98 2.4-1.59 0-.83-.44-1.61-2.67-2.14-2.48-.6-4.18-1.62-4.18-3.67 0-1.72 1.39-2.84 3.11-3.21V4h2.67v1.95c1.86.45 2.79 1.86 2.85 3.39H14.3c-.05-1.11-.64-1.87-2.22-1.87-1.5 0-2.4.68-2.4 1.64 0 .84.65 1.39 2.67 1.91s4.18 1.39 4.18 3.91c-.01 1.83-1.38 2.83-3.12 3.16z"/>
                            </svg>
                          </div>
                          
                          {/* Loading Text */}
                          <span className="text-xs text-slate-600 dark:text-slate-400 font-medium">
                            Analyzing insights...
                          </span>
                          
                          {/* Spinning Gear */}
                          <div className="text-slate-500 dark:text-slate-400 animate-spin">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M12,15.5A3.5,3.5 0 0,1 8.5,12A3.5,3.5 0 0,1 12,8.5A3.5,3.5 0 0,1 15.5,12A3.5,3.5 0 0,1 12,15.5M19.43,12.97C19.47,12.65 19.5,12.33 19.5,12C19.5,11.67 19.47,11.34 19.43,11L21.54,9.37C21.73,9.22 21.78,8.95 21.66,8.73L19.66,5.27C19.54,5.05 19.27,4.96 19.05,5.05L16.56,6.05C16.04,5.66 15.5,5.32 14.87,5.07L14.5,2.42C14.46,2.18 14.25,2 14,2H10C9.75,2 9.54,2.18 9.5,2.42L9.13,5.07C8.5,5.32 7.96,5.66 7.44,6.05L4.95,5.05C4.73,4.96 4.46,5.05 4.34,5.27L2.34,8.73C2.22,8.95 2.27,9.22 2.46,9.37L4.57,11C4.53,11.34 4.5,11.67 4.5,12C4.5,12.33 4.53,12.65 4.57,12.97L2.46,14.63C2.27,14.78 2.22,15.05 2.34,15.27L4.34,18.73C4.46,18.95 4.73,19.03 4.95,18.95L7.44,17.94C7.96,18.34 8.5,18.68 9.13,18.93L9.5,21.58C9.54,21.82 9.75,22 10,22H14C14.25,22 14.46,21.82 14.5,21.58L14.87,18.93C15.5,18.68 16.04,18.34 16.56,17.94L19.05,18.95C19.27,19.03 19.54,18.95 19.66,18.73L21.66,15.27C21.78,15.05 21.73,14.78 21.54,14.63L19.43,12.97Z"/>
                            </svg>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Show animation even if no content yet but is streaming */}
                  {!message.content && message.isStreaming && (
                    <div className="flex items-center gap-2 p-2 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-slate-700 dark:to-slate-600 rounded-lg">
                      {/* Single Animated Dot */}
                      <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                      {/* Bouncing Sales Icon (smaller) */}
                      <div className="text-emerald-600 dark:text-emerald-400 animate-bounce">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M16,17V19H2V17S2,13 9,13 16,17 16,17M12.5,7.5A3.5,3.5 0 0,0 9,11A3.5,3.5 0 0,0 12.5,14.5A3.5,3.5 0 0,0 16,11A3.5,3.5 0 0,0 12.5,7.5M15.94,13A5.32,5.32 0 0,1 18,17V19A2,2 0 0,1 16,21H2A2,2 0 0,1 0,19V17C0,13.9 3.1,13 9,13C11.43,13 13.4,13.35 14.78,13.78L22,6.5L20.5,5L15.94,13Z"/>
                        </svg>
                      </div>
                      {/* Pulsing Text (smaller) */}
                      <span className="text-xs text-slate-600 dark:text-slate-400 font-medium animate-pulse">
                        Processing sales insights...
                      </span>
                    </div>
                  )}                  
                  {/* Timestamp and Response Time */}
                  <div className={`flex items-center justify-between text-xs mt-2 ${
                    message.type === 'user' 
                      ? 'text-blue-100' 
                      : 'text-slate-500 dark:text-slate-400'
                  }`}>
                    <span>
                      {message.timestamp.toLocaleTimeString([], { 
                        hour: '2-digit', 
                        minute: '2-digit' 
                      })}
                    </span>                    
                    {message.type === 'assistant' && (
                      <div className="flex items-center gap-2">
                        {/* Response Time */}
                        {message.responseTime && (
                          <span className="flex items-center gap-1 bg-slate-100 dark:bg-slate-700 px-2 py-1 rounded-full">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <circle cx="12" cy="12" r="10"/>
                              <polyline points="12,6 12,12 16,14"/>
                            </svg>
                            {message.responseTime}ms
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {message.type === 'user' && (
                  <div className="w-10 h-10 bg-gradient-to-br from-purple-200 to-pink-300 rounded-xl flex items-center justify-center shadow-lg flex-shrink-0">
                    <span className="text-purple-700 dark:text-purple-800 font-bold text-lg">U</span>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Sentinel element to ensure container scrolls to show newest message */}
          <div ref={messagesEndRef} />
        </div>
      </div>      
      {/* Input Area */}
      <div className="border-t border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md">
  <div className="max-w-6xl mx-auto px-4 py-4">
          {/* Collapsible Configuration Section */}
          <div className="mb-4">
            {/* Configuration Toggle Button */}
            <button
              onClick={() => setIsConfigExpanded(!isConfigExpanded)}
              className="flex items-center justify-between w-full p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors duration-200"
            >
              <div className="flex items-center gap-2">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-slate-600 dark:text-slate-400"
                >
                  <circle cx="12" cy="12" r="3"/>
                  <path d="M12 1v6m0 6v6"/>
                  <path d="m21 12-6-3-6 3-6-3"/>
                </svg>
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  Configuration Settings
                </span>                
                {(demandPhase !== 'Pre-Demand' || accountName || clientName || accountId || clientId || pursuitId || additionalInstructions) && (
                  <div className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                      <circle cx="12" cy="12" r="10"/>
                    </svg>
                    <span>Configured</span>
                  </div>
                )}
              </div>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`text-slate-600 dark:text-slate-400 transition-transform duration-200 ${
                  isConfigExpanded ? 'rotate-180' : ''
                }`}
              >
                <path d="m6 9 6 6 6-6"/>
              </svg>
            </button>

            {/* Collapsible Configuration Fields */}
            {isConfigExpanded && (
              <div className="mt-3 space-y-4 animate-in slide-in-from-top-2 duration-200">
                {/* Configuration Fields */}
                <div className="flex flex-wrap gap-3 p-3 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
                  <div className="flex flex-col">
                    <label className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                      Demand Phase
                    </label>
                    <select
                      value={demandPhase}
                      onChange={(e) => setDemandPhase(e.target.value)}
                      className="px-3 py-2 text-sm bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-transparent"
                    >
                      <option value="Pre-Demand">Pre-Demand</option>
                      <option value="Need">Need</option>
                      <option value="Pain">Pain</option>
                      <option value="Interest">Interest</option>
                      <option value="Evaluation">Evaluation</option>
                      <option value="Project">Project</option>
                      <option value="Negotiation">Negotiation</option>
                      <option value="Close">Close</option>
                    </select>
                  </div>
                  
                  <div className="flex flex-col">
                    <label className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                      Account Name
                    </label>
                    <input
                      type="text"
                      value={accountName}
                      onChange={(e) => setAccountName(e.target.value)}
                      placeholder="Account name..."
                      maxLength={50}
                      className="px-3 py-2 text-sm bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-800 dark:text-slate-200 placeholder-slate-500 dark:placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-transparent w-48"
                    />
                  </div>
                    
                  <div className="flex flex-col">
                    <label className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                      Client Name
                    </label>
                    <input
                      type="text"
                      value={clientName}
                      onChange={(e) => setClientName(e.target.value)}
                      placeholder="Client name..."
                      maxLength={50}
                      className="px-3 py-2 text-sm bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-800 dark:text-slate-200 placeholder-slate-500 dark:placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-transparent w-48"
                    />
                  </div>

                </div>

              </div>
            )}
          </div>

          {/* Message Input */}
          <form onSubmit={handleSubmit} className="relative">
            <div className="relative flex items-center">
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="Type your message here..."
                disabled={isLoading}
                className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-2xl px-6 py-4 pr-16 text-slate-800 dark:text-slate-200 placeholder-slate-500 dark:placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent shadow-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <button
                type="submit"
                disabled={!inputValue.trim() || isLoading}
                className="absolute right-2 w-12 h-12 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 disabled:from-slate-300 disabled:to-slate-400 dark:disabled:from-slate-600 dark:disabled:to-slate-700 rounded-xl flex items-center justify-center transition-all duration-200 shadow-lg disabled:cursor-not-allowed"
              >
                {isLoading ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                ) : (
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-white"
                  >
                    <path d="m22 2-7 20-4-9-9-4Z" />
                    <path d="M22 2 11 13" />
                  </svg>
                )}
              </button>
            </div>
          </form>
          <div className="flex items-center justify-center mt-3 gap-4 text-xs text-slate-500 dark:text-slate-400">
            <div className="flex items-center gap-1">
              <div className={`w-2 h-2 rounded-full ${isLoading ? 'bg-yellow-500' : 'bg-emerald-500'}`}></div>
              <span>{isLoading ? 'Processing...' : 'AI Assistant Ready'}</span>
            </div>
            <span>•</span>
            <span>Press Enter to send</span>
            {threadId && (
              <>
                <span>•</span>
                <div className="flex items-center gap-1">
                  <span>Thread:</span>
                  <span className="flex items-center gap-1 bg-emerald-100 dark:bg-emerald-900/20 px-2 py-1 rounded-full text-emerald-700 dark:text-emerald-400">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
                    </svg>
                    <span className="font-mono text-xs">
                      {threadId}
                    </span>
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      </div>
    </>
  );
}
