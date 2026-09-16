// Serves the Windows installer from R2. Pages caps files at 25 MB, so the ~90 MB installer lives here.
// GET /Airlock-Setup.exe  -> latest installer (object key set by the publish script)
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const key = url.pathname.replace(/^\/+/, '') || 'Airlock-Setup.exe';
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
    const obj = await env.DOWNLOADS.get(key);
    if (!obj) return new Response('Not found', { status: 404 });
    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    headers.set('etag', obj.httpEtag);
    headers.set('content-disposition', `attachment; filename="${key}"`);
    headers.set('cache-control', 'public, max-age=3600');
    headers.set('access-control-allow-origin', '*');
    return new Response(request.method === 'HEAD' ? null : obj.body, { headers });
  },
};
