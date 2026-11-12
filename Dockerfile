# ---------------------------------------------------------
# Step 1: Build source
# ---------------------------------------------------------
FROM node:24-alpine AS build

WORKDIR /app

# Install all dependencies for building
COPY package.json package-lock.json ./
RUN npm ci --registry https://registry.npmmirror.com/

# Copy source and build
COPY . .
RUN npm run build

# ---------------------------------------------------------
# Step 2: Prepare production node_modules
# ---------------------------------------------------------
FROM node:24-alpine AS prod-deps

WORKDIR /app

# Only install mandatory production dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --registry https://registry.npmmirror.com/

# ---------------------------------------------------------
# Step 3: Minimal Runtime image
# ---------------------------------------------------------
FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production

# Only copy build artifacts and runtime dependencies
COPY --from=build /app/package.json ./
COPY --from=build /app/dist ./dist
COPY --from=build /app/configs ./configs
COPY --from=build /app/public ./public
COPY --from=build /app/*.wasm ./
COPY --from=prod-deps /app/node_modules ./node_modules

EXPOSE 8001

CMD ["npm", "start"]