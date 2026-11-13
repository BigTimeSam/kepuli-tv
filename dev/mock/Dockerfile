# The demo server for Fly.io: dev/mock/server.mjs and the media that
# dev/mock/media.sh has rendered on the machine that builds this. No build
# step, no dependencies — a Node image and two directories.
FROM node:22-alpine
WORKDIR /app
COPY server.mjs ./
COPY media ./media
# KEPULI_MOCK_REVIEW: the image is the demo a store's reviewer signs in to,
# so it serves the reviewer's catalogue however it is run (fly.toml says
# the same): no film or episode that is there to fail.
ENV NODE_ENV=production KEPULI_MOCK_HOST=0.0.0.0 KEPULI_MOCK_PORT=8080 KEPULI_MOCK_REVIEW=1
EXPOSE 8080
CMD ["node", "server.mjs"]
