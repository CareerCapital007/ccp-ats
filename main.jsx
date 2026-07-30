import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './ccp-ats.jsx';
import { supabase, installStorage } from './storage.js';
import { installAnthropicProxy } from './anthropic-shim.js';

installStorage();
installAnthropicProxy();

const GREEN = '#173A2D';
const BRASS = '#A98545';
const PAPER = '#F6F5F1';
const SERIF = 'Georgia, "Times New Roman", serif';

function SignIn() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);

  const send = async () => {
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) setError(error.message);
    else setSent(true);
  };

  return (
    <div style={{ background: PAPER, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: '#fff', border: '1px solid #E2DED4', padding: 32, maxWidth: 400, width: '100%' }}>
        <div style={{ fontFamily: SERIF, fontSize: 22, color: GREEN }}>Career Capital Partners</div>
        <div style={{ fontSize: 10, letterSpacing: 1.6, textTransform: 'uppercase', color: BRASS, fontWeight: 700, marginTop: 4 }}>
          Search Ledger
        </div>

        {sent ? (
          <p style={{ fontSize: 13, color: '#6E7379', lineHeight: 1.6, marginTop: 22 }}>
            Check {email} for a sign-in link. It expires in one hour.
          </p>
        ) : (
          <div style={{ marginTop: 22 }}>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && email.includes('@') && send()}
              placeholder="you@careercapitalpartners.com"
              style={{ width: '100%', padding: '9px 10px', border: '1px solid #E2DED4', fontSize: 13, outline: 'none' }}
            />
            <button
              onClick={send}
              disabled={!email.includes('@')}
              style={{ width: '100%', marginTop: 10, padding: '10px', background: GREEN, color: '#fff', fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer', opacity: email.includes('@') ? 1 : 0.5 }}
            >
              Send sign-in link
            </button>
            {error && <div style={{ fontSize: 12, color: '#9B3B2E', marginTop: 10 }}>{error}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

function Root() {
  const [session, setSession] = useState(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (session === undefined) return <div style={{ background: PAPER, height: '100vh' }} />;
  if (!session) return <SignIn />;
  return <App />;
}

createRoot(document.getElementById('root')).render(<Root />);
