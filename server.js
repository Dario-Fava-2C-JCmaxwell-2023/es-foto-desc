require("dotenv").config();

const http = require("http");
const fs   = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

// ============================================================
// CONFIGURAZIONE
// ============================================================
const PORTA    = process.env.PORT || 3000;
const GROQ_KEY = process.env.GROQ_KEY;
const URL_GROQ = "https://api.groq.com/openai/v1/chat/completions";
const MODELLO  = "meta-llama/llama-4-scout-17b-16e-instruct";

// Blocca l'avvio se la chiave Groq non è configurata
if (!GROQ_KEY || GROQ_KEY === "inserisci_la_tua_chiave_qui") {
    console.error("❌ Chiave Groq mancante! Aggiungila nel file .env");
    console.error("   Chiave gratuita su: https://console.groq.com/keys");
    process.exit(1);
}

// ============================================================
// SERVER HTTP — serve la pagina web al browser
// ============================================================
const serverHttp = http.createServer((richiesta, risposta) => {
    // "/" e "/index.html" puntano entrambi a public/index.html
    const url = richiesta.url === "/" ? "/index.html" : richiesta.url;
    const percorsoFile = path.join(__dirname, "public", url);

    fs.readFile(percorsoFile, (errore, contenuto) => {
        if (errore) {
            risposta.writeHead(404);
            risposta.end("Pagina non trovata");
            return;
        }
        // No-cache: il browser ricarica sempre l'ultima versione di index.html
        risposta.writeHead(200, {
            "Cache-Control": "no-store, no-cache, must-revalidate",
            "Pragma": "no-cache"
        });
        risposta.end(contenuto);
    });
});

// ============================================================
// SERVER WEBSOCKET — comunica in tempo reale col browser
// ============================================================
const serverWs = new WebSocketServer({ server: serverHttp });

serverWs.on("connection", (connessione) => {
    console.log("✅ Browser connesso");

    connessione.on("message", async (messaggioGrezzo) => {
        try {
            const msg = JSON.parse(messaggioGrezzo.toString());

            // --- Tipo 1: l'utente ha caricato una foto da descrivere ---
            if (msg.tipo === "analizza_foto") {
                console.log(`📸 Foto ricevuta: ${msg.nomeFoto}`);

                // Avvisa il browser che stiamo elaborando
                invia(connessione, { tipo: "stato", testo: "⏳ Sto analizzando la foto con l'AI..." });

                // Messaggio per Groq: immagine + istruzioni in italiano
                const messages = [{
                    role: "user",
                    content: [
                        { type: "image_url", image_url: { url: msg.datiBase64 } },
                        { type: "text", text:
                            "Analizza questa immagine e descrivi in italiano:\n" +
                            "1. Cosa vedi (oggetti, persone, animali, luoghi)\n" +
                            "2. I colori principali\n" +
                            "3. L'atmosfera o il contesto generale\n" +
                            "4. Eventuali elementi interessanti o particolari\n\n" +
                            "Rispondi sempre in italiano, in modo chiaro e dettagliato."
                        }
                    ]
                }];

                const descrizione = await chiamaGroq(messages);
                console.log("✨ Descrizione generata");
                invia(connessione, { tipo: "descrizione", testo: descrizione, nomeFoto: msg.nomeFoto });

            // --- Tipo 2: l'utente fa una domanda sulla foto (chat) ---
            } else if (msg.tipo === "domanda_chat") {

                // Ricostruisce la conversazione completa per Groq:
                // [foto iniziale] + [storia chat] + [nuova domanda]
                const messages = [
                    {
                        role: "user",
                        content: [
                            { type: "image_url", image_url: { url: msg.datiBase64 } },
                            { type: "text", text: "Analizza questa immagine e rispondi alle domande in italiano." }
                        ]
                    },
                    ...msg.cronologia,                          // messaggi precedenti (utente + AI)
                    { role: "user", content: msg.domanda }      // nuova domanda dell'utente
                ];

                const risposta = await chiamaGroq(messages);
                console.log("✨ Risposta chat generata");
                invia(connessione, { tipo: "risposta_chat", testo: risposta });
            }

        } catch (errore) {
            console.error("❌ Errore:", errore.message);
            invia(connessione, { tipo: "errore", testo: "Errore: " + errore.message });
        }
    });

    connessione.on("close", () => console.log("👋 Browser disconnesso"));
});

// ============================================================
// FUNZIONI DI SUPPORTO
// ============================================================

// Chiama l'API di Groq con l'array di messaggi e restituisce il testo della risposta
async function chiamaGroq(messages) {
    const risposta = await fetch(URL_GROQ, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${GROQ_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ model: MODELLO, messages, max_tokens: 1024 })
    });

    if (!risposta.ok) {
        const errore = await risposta.text();
        throw new Error(`API Groq (${risposta.status}): ${errore}`);
    }

    const dati = await risposta.json();
    return dati.choices[0].message.content;
}

// Manda un oggetto JSON al browser tramite WebSocket (solo se la connessione è aperta)
function invia(connessione, dati) {
    if (connessione.readyState === connessione.OPEN) {
        connessione.send(JSON.stringify(dati));
    }
}

// ============================================================
// AVVIO
// ============================================================
serverHttp.listen(PORTA, () => {
    console.log("====================================================");
    console.log("🚀 Server avviato!");
    console.log(`   Pagina web → http://localhost:${PORTA}`);
    console.log(`   AI         → ${MODELLO} (Groq)`);
    console.log("====================================================");
});
