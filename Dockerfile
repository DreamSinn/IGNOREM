FROM node:20-bookworm-slim

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.15.0 --activate

COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* tsconfig.json ./
RUN pnpm install --frozen-lockfile

COPY sql ./sql
COPY src ./src
COPY public ./public
COPY README.md ./README.md

ENV NODE_ENV=production
EXPOSE 3000

CMD ["pnpm", "start"]
