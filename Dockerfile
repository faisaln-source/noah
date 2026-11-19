FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg python3 python3-venv fonts-dejavu-core ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY ai/requirements.txt /app/ai/requirements.txt
RUN python3 -m venv /opt/ai && /opt/ai/bin/pip install --no-cache-dir -r ai/requirements.txt 'yt-dlp[default]'
COPY . .
RUN npm run build
ENV HOST=0.0.0.0 PYTHON_PATH=/opt/ai/bin/python PATH="/opt/ai/bin:$PATH"
EXPOSE 3000
CMD ["node", "server.mjs"]
