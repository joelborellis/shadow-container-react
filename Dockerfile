# ---- Build Stage ----
FROM node:22-alpine AS builder

# Set working directory
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy app source
COPY . .

# Build the Next.js app
RUN npm run build

# ---- Production Stage ----
FROM node:22-alpine AS runner

# Set environment to production
ENV NODE_ENV=production

# Set working directory
WORKDIR /app

# Only copy production dependencies
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public

# Expose port (default Next.js port)
EXPOSE 3000

# Start the app
CMD ["npm", "start"]