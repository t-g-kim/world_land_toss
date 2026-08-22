// Supabase Edge Function: Trigger random game events
// Triggered by cron job (e.g., every 12 hours)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const EVENT_TYPES = [
  {
    type: 'boom',
    message: '경제 호황! {territory} 지역의 가치가 급상승했습니다!',
    priceMultiplier: 1.3,
    chance: 0.15,
  },
  {
    type: 'bust',
    message: '경제 불황! {territory} 지역의 가치가 하락했습니다.',
    priceMultiplier: 0.75,
    chance: 0.1,
  },
  {
    type: 'disaster',
    message: '자연재해 발생! {territory} 지역이 피해를 입었습니다.',
    priceMultiplier: 0.6,
    chance: 0.05,
  },
  {
    type: 'info',
    message: '{territory} 지역에 대규모 개발 계획이 발표되었습니다!',
    priceMultiplier: 1.5,
    chance: 0.08,
  },
];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Pick random territories to apply events
    const { data: territories, error } = await supabase
      .from('territories')
      .select('id, name, current_price, base_price, owner_id')
      .limit(100);

    if (error) throw error;

    const events: any[] = [];

    for (const territory of territories || []) {
      // Pick a random event
      for (const eventDef of EVENT_TYPES) {
        if (Math.random() < eventDef.chance) {
          const newPrice = Math.max(
            Math.round(territory.base_price * 0.3),
            Math.round(territory.current_price * eventDef.priceMultiplier)
          );

          // Update price
          await supabase
            .from('territories')
            .update({ current_price: newPrice })
            .eq('id', territory.id);

          const message = eventDef.message.replace('{territory}', territory.name);

          // Create event notification
          if (territory.owner_id) {
            await supabase.from('game_events').insert({
              event_type: eventDef.type,
              territory_id: territory.id,
              target_user_id: territory.owner_id,
              message,
              data: { old_price: territory.current_price, new_price: newPrice },
            });
          }

          events.push({ territory: territory.name, event: eventDef.type, newPrice });
          break; // One event per territory
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        events_triggered: events.length,
        events,
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
