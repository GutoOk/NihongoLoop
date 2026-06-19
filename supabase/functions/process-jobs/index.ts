import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const headers = {
  "Content-Type": "application/json",
};

serve(() => {
  return new Response(
    JSON.stringify({
      error: "process-jobs Edge Function desativada. O pipeline oficial e unico e o worker persistente de ai_jobs.",
    }),
    { status: 410, headers },
  );
});
