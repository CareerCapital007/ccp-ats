export default async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // Confirm the caller holds a live login token issued by this Supabase project.
  const token = (req.headers.get('authorization') || '').replace('Bearer ', '').trim();
  try {
    const body = token.split('.')[1];
    const claims = JSON.parse(
      atob(body.replace(/-/g, '+').replace(/_/g, '/'))
    );
    const projectRef = (process.env.SUPABASE_URL || '').split('//')[1].split('.')[0];
    const validIssuer = (claims.iss || '').includes(projectRef);
    const notExpired = claims.exp * 1000 > Date.now();
    if (!validIssuer || !notExpired) {
      return new Response('Sign in required', { status: 401 });
    }
  } catch (e) {
    return new Response('Sign in required', { status: 401 });
  }

  const payload = JSON.parse(await req.text());
  payload.model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(payload),
  });

  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: { 'content-type': 'application/json' },
  });
};
