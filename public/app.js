// --------------- GLOBAL DOM SELECTORS --------------- //
const connectBtn = document.getElementById("connectBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const audioPlaybackToggle = document.getElementById("audioPlaybackToggle");

const conversationLogDiv = document.getElementById("conversation-log");
const textInput = document.getElementById("textInput");
const sendButton = document.getElementById("sendButton");

// --------------- GLOBAL STATE ---------------- //
let pc = null;       
let dc = null;       
let localAudioTrack = null;
let ephemeralKey = null;
let isConnected = false;

let vadEnabled = true; // default to VAD mode

// store conversation messages in an array.

// --------------- TRANSCRIPT FORMATTING --------------- //
// each item: { id, role: 'user'|'assistant', text: '', sequence: number }

const conversationMessages = [];

// keep a global sequence counter that increments each time add a new message
let messageSequence = 0;

// --------------- Transcript Management --------------- //
function doesTranscriptItemExist(itemId) {
  return conversationMessages.some(msg => msg.id === itemId);
}

function addTranscriptMessage(itemId, role, initialText = "") {
  if (doesTranscriptItemExist(itemId)) return;

  const newMsg = {
    id: itemId,
    role,
    text: initialText,
    sequence: messageSequence++
  };
  conversationMessages.push(newMsg);
  renderConversation();
}

function updateTranscriptMessage(itemId, newText, append = false) {
  const msg = conversationMessages.find(m => m.id === itemId);
  if (!msg) return;
  msg.text = append ? msg.text + newText : newText;
  renderConversation();
}

function renderConversation() {
  // sort by sequence ascending
  conversationMessages.sort((a, b) => a.sequence - b.sequence);

  conversationLogDiv.innerHTML = "";
  for (const msg of conversationMessages) {
    const sender = (msg.role === "user") ? "User" : "Assistant";
    const className = (msg.role === "user") ? "message-user" : "message-assistant";

    // Replace **text** with <strong>text</strong>
    let formattedText = msg.text.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");

    // Create a container div for the message
    const msgDiv = document.createElement("div");
    msgDiv.className = className;

    // Instead of innerText, we use innerHTML to render bold tags
    msgDiv.innerHTML = `${sender}: ${formattedText}`;
    conversationLogDiv.appendChild(msgDiv);
  }
  conversationLogDiv.scrollTop = conversationLogDiv.scrollHeight;
}

function logMessage(sender, text, className = "message-assistant") {
  const msgDiv = document.createElement("div");
  msgDiv.className = className;
  msgDiv.innerText = sender + ": " + text;
  conversationLogDiv.appendChild(msgDiv);
  conversationLogDiv.scrollTop = conversationLogDiv.scrollHeight;
}

// --------------- EPHEMERAL KEY LOGIC --------------- //
async function fetchEphemeralKey() {
  const resp = await fetch("/api/session");
  const data = await resp.json();
  console.log("[client] ephemeral key data:", data);
  ephemeralKey = data?.client_secret?.value || null;
  if (!ephemeralKey) {
    throw new Error("No ephemeral key found in server response");
  }
}

// --------------- REALTIME CONNECTION --------------- //
async function connectToRealtime() {
  try {
    await fetchEphemeralKey();

    pc = new RTCPeerConnection();
    const assistantAudioEl = document.getElementById("assistantAudio");
    pc.ontrack = (event) => {
      // assistant's remote audio
      assistantAudioEl.srcObject = event.streams[0];
    };

    // capture local user audio
    const localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    localAudioTrack = localStream.getAudioTracks()[0];
    localAudioTrack.enabled = false;

    pc.addTrack(localAudioTrack, localStream);

    dc = pc.createDataChannel("oai-events");
    dc.onopen = () => {
      isConnected = true;
      disconnectBtn.disabled = false;
      connectBtn.disabled = true;
      logMessage("System", "Connected to Realtime API", "message-assistant");
      updateSessionState();
    };
    dc.onclose = () => {
      isConnected = false;
      disconnectBtn.disabled = true;
      connectBtn.disabled = false;
      logMessage("System", "Data channel closed", "message-assistant");
    };
    dc.onerror = (err) => console.error("[client] dataChannel error:", err);

    dc.onmessage = (e) => {
      console.log("[client] dataChannel msg => ", e.data);
      const evt = JSON.parse(e.data);
      handleServerEvent(evt);
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const sdpResponse = await fetch(
      "https://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17",
      {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${ephemeralKey}`,
          "Content-Type": "application/sdp",
        },
      }
    );
    const answerSdp = await sdpResponse.text();
    const remoteDesc = { type: "answer", sdp: answerSdp };
    await pc.setRemoteDescription(remoteDesc);

    logMessage("Assistant", "Connection established!", "message-assistant");
  } catch (err) {
    console.error("[client] connect error:", err);
    logMessage("System", `Failed to connect: ${err}`, "message-assistant");
  }
}

function disconnectRealtime() {
  if (dc) {
    dc.close();
    dc = null;
  }
  if (pc) {
    pc.getSenders().forEach(sender => {
      if (sender.track) sender.track.stop();
    });
    pc.close();
    pc = null;
  }
  connectBtn.disabled = false;
  disconnectBtn.disabled = true;
  isConnected = false;
  logMessage("System", "Disconnected from Realtime API.", "message-assistant");
}

// --------------- SENDING TYPED MESSAGES --------------- //
function sendUserText() {
  const textVal = textInput.value.trim();
  if (!textVal || !dc || dc.readyState !== "open") return;

  textInput.value = "";

  // create a user message item

  dc.send(JSON.stringify({
    type: "conversation.item.create",
    item: {
      id: "user_" + Date.now(),
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: textVal }]
    }
  }));

  // for typed messages we also need to ask for a response

  dc.send(JSON.stringify({ type: "response.create" }));
}

// --------------- UI HOOKUPS --------------- //
sendButton.addEventListener("click", sendUserText);
textInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendUserText();
});
connectBtn.addEventListener("click", connectToRealtime);
disconnectBtn.addEventListener("click", disconnectRealtime);

// Audio playback toggle
audioPlaybackToggle.addEventListener("change", (e) => {
  const audioEl = document.getElementById("assistantAudio");
  if (e.target.checked) {
    audioEl.muted = false;
    audioEl.play().catch((err) => console.warn("Autoplay blocked:", err));
  } else {
    audioEl.muted = true;
  }
});

// --------------- session.update LOGIC --------------- //
function updateSessionState() {
  if (!dc || dc.readyState !== "open") return;

  let turnDetection = null;
  let micShouldBeOn = false;

  if (vadEnabled) {
    micShouldBeOn = true;
    turnDetection = {
      type: "server_vad",
      threshold: 0.5,
      prefix_padding_ms: 300,
      silence_duration_ms: 300,
      // do NOT put create_response here !!
      // because we handle response creation ourselves after final user transcripts
    };
  } else {
    // no VAD, thus, mic off
    micShouldBeOn = false;
    turnDetection = null;
  }

  // Enable or disable local track
  if (localAudioTrack) {
    localAudioTrack.enabled = micShouldBeOn;
  }

  const agent = window.inventoryAgent;
  console.log("Using agent:", agent);

  const sessionUpdateEvent = {
    type: "session.update",
    session: {
      modalities: ["text", "audio"],
      input_audio_format: "pcm16",
      output_audio_format: "pcm16",
      input_audio_transcription: { model: "whisper-1" },
      turn_detection: turnDetection,

      // agent instructions and tools
      instructions: agent.instructions,
      tools: agent.tools
    }
  };
  dc.send(JSON.stringify(sessionUpdateEvent));
  console.log("[client] session.update =>", sessionUpdateEvent);
}

// --------------- HANDLE INCOMING EVENTS --------------- //
function handleServerEvent(evt) {
  console.log("[client] handleServerEvent => ", evt);

  switch (evt.type) {

    // typed user or typed assistant messages

    case "conversation.item.created": {
      const item = evt.item;
      if (item && item.content && item.content[0]) {
        const text = item.content[0].text || item.content[0].transcript || "";
        if (!text) break;

        if (item.role === "assistant") {
          addTranscriptMessage(item.id, "assistant", text);
        } else if (item.role === "user") {
          addTranscriptMessage(item.id, "user", text);
        }
      }
      break;
    }

    // partial user transcripts (whisper partial)

    case "conversation.item.input_audio_transcription.delta": {
      const itemId = evt.item_id;
      if (!itemId) break;
      const partialText = evt.delta || "";

      if (!doesTranscriptItemExist(itemId)) {
        addTranscriptMessage(itemId, "user", "");
      }
      updateTranscriptMessage(itemId, partialText, true);
      break;
    }

    // final user transcripts => after final user transcript, ask for an assistant response

    case "conversation.item.input_audio_transcription.completed": {
      const itemId = evt.item_id;
      if (!itemId) break;
      const finalTranscript =
        (!evt.transcript || evt.transcript.trim() === "")
          ? "[inaudible]"
          : evt.transcript;

      if (!doesTranscriptItemExist(itemId)) {
        addTranscriptMessage(itemId, "user", "");
      }
      updateTranscriptMessage(itemId, finalTranscript, false);

      if (dc && dc.readyState === "open") {
        dc.send(JSON.stringify({ type: "response.create" }));
      }
      break;
    }

    // partial assistant transcripts

    case "response.audio_transcript.delta": {
      const itemId = evt.item_id;
      if (!itemId) break;
      const deltaText = evt.delta || "";

      if (!doesTranscriptItemExist(itemId)) {
        addTranscriptMessage(itemId, "assistant", "");
      }
      updateTranscriptMessage(itemId, deltaText, true);
      break;
    }

    // function calls

    case "response.done": {
      if (evt.response && evt.response.output) {
        evt.response.output.forEach((out) => {
          if (out.type === "function_call" && out.name && out.arguments) {
            handleFunctionCall(out.name, out.arguments, out.call_id);
          }
        });
      }
      break;
    }

    default:
      console.log("[client] unhandled event:", evt);
  }
}

// function call for lookupInventory

async function handleFunctionCall(fnName, fnArgs, callId) {
  const parsedArgs = JSON.parse(fnArgs);

  // use agent from inventoryAgent.js

  const agent = window.inventoryAgent;
  console.log("[client] function call =>", fnName, parsedArgs);

  if (fnName === "lookupInventory") {
    const result = await agent.toolLogic.lookupInventory(parsedArgs);

    // send function_call_output + request another response

    dc.send(JSON.stringify({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify(result)
      }
    }));
    dc.send(JSON.stringify({ type: "response.create" }));
  } else {
    console.log("Unhandled function call:", fnName);
  }
}