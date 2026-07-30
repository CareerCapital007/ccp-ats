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
const LINE = '#E2DED4';
const RED = '#9B3B2E';
const SERIF = 'Georgia, "Times New Roman", serif';

function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const signIn = async () => {
    setError(null);
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    setBusy(false);
  };

  const ready = email.includes('@') && password.length >= 6;

  return (
    <div style={{ background: PAPER, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: '#fff', border: `1px solid ${LINE}`, padding: 32, maxWidth: 400, width: '100%' }}>
        <div style={{ fontFamily: SERIF, fontSize: 22, color: GREEN }}>Career Capital Partners</div>
        <div style={{ fontSize: 10, letterSpacing: 1.6, textTransform: 'uppercase', color: BRASS, fontWeight: 700, marginTop: 4 }}>
          Search Ledger
        </div>

        <div style={{ marginTop: 22 }}>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            autoComplete="username"
            style={{ width: '100%', padding: '9px 10px', border: `1px solid ${LINE}`, fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && ready && signIn()}
            placeholder="Password"
            autoComplete="current-password"
            style={{ width: '100%', marginTop: 8, padding: '9px 10px', border: `1px solid ${LINE}`, fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
          />
          <button
            onClick={signIn}
            disabled={!ready || busy}
            style={{ width: '100%', marginTop: 10, padding: '10px', background: GREEN, color: '#fff', fontSize: 13, fontWeight: 600, border: 'none', cursor: ready ? 'pointer' : 'not-allowed', opacity: ready && !busy ? 1 : 0.5 }}
          >
            {busy ? 'Signing in' : 'Sign in'}
          </button>

          {error && (
            <div style={{ marginTop: 12, padding: '9px 11px', background: '#FBEAE6', color: RED, fontSize: 12.5, lineHeight: 1.5 }}>
              {error}
            </div>
          )}

          <div style={{ marginTop: 16, fontSize: 11.5, color: '#6E7379', lineHeight: 1.6 }}>
            Accounts are created by an administrator. Contact Joe if you need access.
          </div>
        </div>
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

