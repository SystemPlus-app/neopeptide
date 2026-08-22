export default function middleware(request) {
  const url = new URL(request.url);
  const isNeoWellness =
    url.hostname === 'neowellness.blog' ||
    url.hostname === 'www.neowellness.blog';

  if (isNeoWellness && url.pathname === '/') {
    url.pathname = '/neowellness.html';
    return fetch(url, request);
  }
}

export const config = {
  matcher: '/',
};
