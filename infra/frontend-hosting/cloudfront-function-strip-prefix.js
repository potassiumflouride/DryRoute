// CloudFront Function, viewer-request event.
// Strips the /api and /tiles path prefixes before forwarding to their
// respective origins, mirroring frontend/vite.config.ts's dev-only proxy
// rewrite (backend routes and the pmtiles server both expect unprefixed
// paths - see infra/frontend-hosting/README.md for the code references).
function handler(event) {
    var request = event.request;
    var uri = request.uri;

    if (uri.indexOf("/api/") === 0) {
        request.uri = uri.substring(4);
    } else if (uri.indexOf("/tiles/") === 0) {
        request.uri = uri.substring(6);
    }

    return request;
}
