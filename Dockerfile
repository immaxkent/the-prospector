# Built on your machine and shipped as an image: the box is too small to build on.
FROM oven/bun:1.2-slim AS build
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile
COPY . .
# Stamped into the bundle so the running app can say which deploy it is.
ARG APP_VERSION=dev
ARG APP_COMMIT=local
ARG APP_BUILT_AT=
ENV VITE_APP_VERSION=$APP_VERSION VITE_APP_COMMIT=$APP_COMMIT VITE_APP_BUILT_AT=$APP_BUILT_AT
RUN bun run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# The worker runs the same image with a different command, so it needs the sources tsx executes.
COPY --from=build /app/.output ./.output
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/db ./db
COPY --from=build /app/src ./src
# The migration command runs scripts/db.ts inside this image.
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/package.json ./package.json
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
