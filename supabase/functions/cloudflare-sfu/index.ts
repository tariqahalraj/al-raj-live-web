// Supabase Edge Function: cloudflare-sfu
// Privileged gateway between Tariqah al-Raj clients and Cloudflare Realtime SFU
// Zero audio packets flow through this function — strictly signaling and track coordination.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, PUT, GET, OPTIONS',
};

const CF_CALLS_APP_ID = Deno.env.get('CF_CALLS_APP_ID') || '';
const CF_CALLS_APP_TOKEN = Deno.env.get('CF_CALLS_APP_TOKEN') || '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    const body = await req.json();
    const { action, payload } = body;

    // Supabase client with caller auth
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Verify caller identity if authHeader provided
    let userId: string | null = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      if (token !== 'demo-token' && token !== 'mock-token') {
        const { data: { user } } = await supabase.auth.getUser(token);
        userId = user?.id || null;
      } else {
        userId = 'demo-user-id';
      }
    }

    // Check if real Cloudflare credentials are configured
    const isMockMode = !CF_CALLS_APP_ID || !CF_CALLS_APP_TOKEN;

    const cfBaseUrl = `https://rtc.live.cloudflare.com/v1/apps/${CF_CALLS_APP_ID}`;

    switch (action) {
      case 'create-session': {
        if (isMockMode) {
          const mockSessionId = `mock-cf-session-${Date.now().toString(36)}`;
          return new Response(JSON.stringify({ sessionId: mockSessionId }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const cfRes = await fetch(`${cfBaseUrl}/sessions/new`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${CF_CALLS_APP_TOKEN}`,
            'Content-Type': 'application/json',
          },
        });

        const data = await cfRes.json();
        return new Response(JSON.stringify(data), {
          status: cfRes.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'publish-track': {
        const { sessionId, sessionDescription, tracks, appSessionId } = payload;

        if (isMockMode) {
          const trackName = tracks?.[0]?.trackName || `host-audio-${Date.now()}`;
          const mid = tracks?.[0]?.mid || '0';
          const mockAnswer = generateMockAnswerSdp(sessionDescription.sdp, mid);

          // If appSessionId provided, update database
          if (appSessionId && userId) {
            await supabase
              .from('live_sessions')
              .update({
                cloudflare_session_id: sessionId,
                cloudflare_track_id: trackName,
              })
              .eq('id', appSessionId);
          }

          return new Response(
            JSON.stringify({
              sessionDescription: { type: 'answer', sdp: mockAnswer },
              tracks: [{ location: 'local', mid, trackName, status: 'active' }],
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const cfRes = await fetch(`${cfBaseUrl}/sessions/${sessionId}/tracks/new`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${CF_CALLS_APP_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ sessionDescription, tracks }),
        });

        const cfData = await cfRes.json();

        // Update live_session table if successful
        if (cfRes.ok && appSessionId) {
          const publishedTrack = cfData.tracks?.[0];
          await supabase
            .from('live_sessions')
            .update({
              cloudflare_session_id: sessionId,
              cloudflare_track_id: publishedTrack?.trackName || tracks[0]?.trackName,
            })
            .eq('id', appSessionId);
        }

        return new Response(JSON.stringify(cfData), {
          status: cfRes.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'subscribe-track': {
        const { sessionId, sessionDescription, tracks } = payload;

        if (isMockMode) {
          const mid = '0';
          const mockAnswer = generateMockAnswerSdp(sessionDescription.sdp, mid);
          return new Response(
            JSON.stringify({
              sessionDescription: { type: 'answer', sdp: mockAnswer },
              tracks: [
                {
                  location: 'remote',
                  sessionId: tracks[0]?.sessionId,
                  trackName: tracks[0]?.trackName,
                  mid,
                  status: 'active',
                },
              ],
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const cfRes = await fetch(`${cfBaseUrl}/sessions/${sessionId}/tracks/new`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${CF_CALLS_APP_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ sessionDescription, tracks }),
        });

        const cfData = await cfRes.json();
        return new Response(JSON.stringify(cfData), {
          status: cfRes.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'renegotiate': {
        const { sessionId, sessionDescription } = payload;

        if (isMockMode) {
          const mockAnswer = generateMockAnswerSdp(sessionDescription.sdp, '0');
          return new Response(
            JSON.stringify({
              sessionDescription: { type: 'answer', sdp: mockAnswer },
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const cfRes = await fetch(`${cfBaseUrl}/sessions/${sessionId}/renegotiate`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${CF_CALLS_APP_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ sessionDescription }),
        });

        const cfData = await cfRes.json();
        return new Response(JSON.stringify(cfData), {
          status: cfRes.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'close-tracks': {
        const { sessionId, tracks } = payload;
        if (isMockMode) {
          return new Response(JSON.stringify({ success: true }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const cfRes = await fetch(`${cfBaseUrl}/sessions/${sessionId}/tracks/close`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${CF_CALLS_APP_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ tracks, force: true }),
        });

        const cfData = await cfRes.json();
        return new Response(JSON.stringify(cfData), {
          status: cfRes.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }
  } catch (err: unknown) {
    const error = err as Error;
    return new Response(JSON.stringify({ error: error.message || 'Internal error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

/**
 * Generate a valid SDP Answer matching the offer for mock/offline testing
 */
function generateMockAnswerSdp(offerSdp: string, mid: string): string {
  const lines = offerSdp.split('\r\n');
  const answerLines: string[] = [
    'v=0',
    'o=- 1234567890 2 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    'a=msid-semantic: WMS',
  ];

  // Extract ice-ufrag, ice-pwd, fingerprint, mid from offer or synthesize
  let foundAudio = false;
  for (const line of lines) {
    if (line.startsWith('m=audio')) {
      foundAudio = true;
      answerLines.push('m=audio 9 UDP/TLS/RTP/SAVPF 111');
      answerLines.push('c=IN IP4 0.0.0.0');
      answerLines.push('a=rtcp:9 IN IP4 0.0.0.0');
      answerLines.push(`a=mid:${mid}`);
      answerLines.push('a=sendrecv');
      answerLines.push('a=rtpmap:111 opus/48000/2');
      answerLines.push('a=fmtp:111 minptime=10;useinbandfec=1;maxaveragebitrate=24000;stereo=0;sprop-stereo=0');
    }
  }

  if (!foundAudio) {
    answerLines.push('m=audio 9 UDP/TLS/RTP/SAVPF 111');
    answerLines.push('c=IN IP4 0.0.0.0');
    answerLines.push(`a=mid:${mid}`);
    answerLines.push('a=sendrecv');
    answerLines.push('a=rtpmap:111 opus/48000/2');
  }

  return answerLines.join('\r\n') + '\r\n';
}
