// Supabase Edge Function: Random price fluctuations
// Triggered by cron job every 6 hours

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Get all territories
    const { data: territories, error: fetchError } = await supabase
      .from('territories')
      .select('id, current_price, base_price');

    if (fetchError) throw fetchError;

    let updatedCount = 0;

    for (const territory of territories || []) {
      // Random fluctuation between -5% and +5%
      const fluctuation = (Math.random() - 0.5) * 0.1; // -0.05 to +0.05
      const newPrice = Math.max(
        Math.round(territory.base_price * 0.5), // Floor at 50% of base price
        Math.round(territory.current_price * (1 + fluctuation))
      );

      if (newPrice !== territory.current_price) {
        const { error: updateError } = await supabase
          .from('territories')
          .update({ current_price: newPrice })
          .eq('id', territory.id);

        if (!updateError) updatedCount++;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        updated: updatedCount,
        total: territories?.length || 0,
        timestamp: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
