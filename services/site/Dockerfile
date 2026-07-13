# BlammyTV marketing site — a self-contained static nginx container.
#
# Build context is this folder (services/site). In Coolify, set the
# Base Directory to `services/site` and the build pack to Dockerfile.
FROM nginx:stable-alpine

# Our server block: gzip, cache headers, a /health endpoint.
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy only the real site content — not this Dockerfile or nginx.conf,
# so config files never end up served from the web root.
COPY index.html /usr/share/nginx/html/
COPY assets/ /usr/share/nginx/html/assets/

EXPOSE 80
# nginx:alpine's default CMD already runs nginx in the foreground.
