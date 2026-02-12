FROM node:18-alpine

WORKDIR /app

# Install dependencies first (better caching)
COPY package*.json ./
RUN npm install --production

# Copy application code
COPY src/ ./src/
COPY test/ ./test/

# Create data directory
RUN mkdir -p /app/data/segments

# Expose port
EXPOSE 3000

# Environment defaults
ENV NODE_ENV=production
ENV PORT=3000
ENV STORAGE_DIR=/app/data

# Health check
HEALTHCHECK --interval=60s --timeout=10s --start-period=30s \
  CMD wget -q --spider http://localhost:3000/api/health || exit 1

# Run as non-root
RUN addgroup -g 1001 -S encore && \
    adduser -S -D -H -u 1001 -h /app -s /sbin/nologin -G encore encore && \
    chown -R encore:encore /app
USER encore

CMD ["node", "src/index.js"]
