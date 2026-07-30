import { supabase } from './storage.js';

const DIRECT = 'https://api.anthropic.com/v1/messages';
const PROXY = '/.netlify/functions/anthropic';

/**
 * The app calls the Anthropic endpoint directly, which is correct inside a Claude
 * artifact but would expose your API key in a real browser. This intercepts that
 * one URL and sends it to the serverless function instead, which holds the key.
 * Every other fetch in the app is untouched.
 */
export function installAnthropicProxy() {
  const original = window.fetch.bind(window);

  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url;
    if (url !== DIRECT) return original(input, init);

    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;

    return original(PROXY, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: init.body,
    });
  };
}
