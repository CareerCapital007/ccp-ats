export default async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const token = (req.headers.get('authorization') || '').replace('Bearer ', '').trim();
  const projectRef = (process.env.SUPABASE_URL || '').split('//')[1]?.split('.')[0];

  let reason = null;
  try {
    const claims = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64url').toString('utf8')
    );
    if (!projectRef) reason = 'SUPABASE_URL not set';
    else if (!String(claims.iss || '').includes(projectRef)) reason = 'issuer mismatch';
    else if (claims.exp * 1000 <= Date.now()) reason = 'token expired';
  } catch (e) {
    reason = 'could not decode token';
  }

  if (reason) {
    console.log('AUTH REJECTED:', reason);
    return new Response(`Sign in required (${reason})`, { status: 401 });
  }

  const payload = JSON.parse(await req.text());
  payload.model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
  payload.max_tokens = 4000;

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
