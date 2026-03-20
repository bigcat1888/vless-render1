import { serve } from "https://deno.land/std@0.208.0/http/server.ts";

const UUID = Deno.env.get("UUID") || "b2924866-2d0d-47f1-98c6-3e33ca70e612";
const PORT = parseInt(Deno.env.get("PORT") || "8080");
const WSPATH = Deno.env.get("WSPATH") || "/vless";

console.log(`🚀 VLESS server starting on port ${PORT}`);

serve(async (req) => {
  const url = new URL(req.url);

  if (url.pathname === WSPATH && req.headers.get("upgrade") === "websocket") {
    const { socket, response } = Deno.upgradeWebSocket(req);
    let conn: Deno.Conn | null = null;

    socket.onmessage = async (e) => {
      const data = new Uint8Array(await e.data.arrayBuffer());

      if (!conn) {
        // Минимальный парсинг VLESS для проверки UUID и извлечения адреса
        const userUUID = Array.from(data.slice(1, 17)).map(b => b.toString(16).padStart(2, '0')).join('');
        const cleanUUID = UUID.replace(/-/g, '');
        
        if (userUUID !== cleanUUID) {
          socket.close(1002, "Invalid UUID");
          return;
        }

        const optLen = data[17];
        const port = (data[18 + optLen] << 8) + data[19 + optLen];
        const addrType = data[21 + optLen];
        let addr = "";

        if (addrType === 1) addr = data.slice(22 + optLen, 26 + optLen).join('.');
        else if (addrType === 2) addr = new TextDecoder().decode(data.slice(23 + optLen, 23 + optLen + data[22 + optLen]));

        try {
          conn = await Deno.connect({ hostname: addr, port });
          const headerLen = 23 + optLen + (addrType === 2 ? data[22 + optLen] : addrType === 1 ? 3 : 15);
          if (data.length > headerLen) await conn.write(data.slice(headerLen));
          
          (async () => {
            const buf = new Uint8Array(32768);
            while (conn) {
              const n = await conn.read(buf);
              if (n === null) break;
              if (socket.readyState === 1) socket.send(buf.slice(0, n));
            }
          })();
        } catch (err) {
          socket.close();
        }
      } else {
        await conn.write(data);
      }
    };

    socket.onclose = () => { conn?.close(); conn = null; };
    socket.onerror = () => { conn?.close(); conn = null; };

    return response;
  }

  return new Response("Server is running", { status: 200 });
}, { port: PORT });
