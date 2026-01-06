# Stage 1: Build SDK
FROM node:22-alpine AS sdk-builder

WORKDIR /app/sdk

# Copy SDK package files
COPY sdk/package*.json ./
RUN npm ci

# Copy SDK source and build
COPY sdk/ ./
RUN npm run build

# Stage 2: Build frontend
FROM node:22-alpine AS frontend-builder

WORKDIR /app

# Copy SDK build output (needed by console prebuild)
COPY --from=sdk-builder /app/sdk/dist ./sdk/dist

WORKDIR /app/console

# Copy frontend package files
COPY console/package*.json ./
RUN npm ci

# Copy frontend source and build
COPY console/ ./
RUN npm run build

# Stage 3: Build API
FROM node:22-alpine AS api-builder

WORKDIR /app/api

# Copy API package files
COPY api/package*.json ./
RUN npm ci

# Copy API source and build
COPY api/ ./
RUN npm run build

# Stage 4: Production image
FROM node:22-alpine AS production

WORKDIR /app

# Install production dependencies only
COPY api/package*.json ./
RUN npm ci --omit=dev

# Copy built API
COPY --from=api-builder /app/api/dist ./dist

# Copy built frontend to API public folder
COPY --from=frontend-builder /app/console/dist ./dist/public

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001 -G nodejs

USER nestjs

EXPOSE 3000

CMD ["node", "dist/main.js"]
