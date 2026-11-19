const endpoint = "https://yptfcpxaihfboteltuhq.supabase.co/functions/v1/store-orders";
const sessionId = new URLSearchParams(location.search).get("session_id") ?? "";
const form = document.getElementById("claim");
const email = document.getElementById("email");
const button = document.getElementById("claim-button");
const download = document.getElementById("download");
const feedback = document.getElementById("feedback");
const accessCode = document.getElementById("access-code");

if (/^cs_live_[A-Za-z0-9]{8,240}$/.test(sessionId)) {
  form.hidden = false;
} else {
  feedback.textContent = "Open the download page from the confirmation after your Stripe payment.";
}

const messages = {
  invalid_checkout: "We couldn’t verify this checkout. Check that you entered the same email you used when paying.",
  payment_pending: "Stripe is still confirming the payment. Check again once Stripe confirms it.",
  access_unavailable: "We couldn’t show your code. Contact Shredbound support for help.",
  limited: "Too many attempts. Wait 10 minutes and try again.",
  unavailable: "Checkout verification is temporarily unavailable. Try again in a moment.",
};

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  button.disabled = true;
  feedback.textContent = "Verifying payment…";
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "claim_checkout", sessionId, email: email.value.trim() }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      feedback.textContent = Object.hasOwn(messages, result.error) ? messages[result.error] : messages.unavailable;
      return;
    }
    const url = new URL(result.downloadUrl);
    if (typeof result.code !== "string" || !/^SB-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(result.code)
        || typeof result.downloadPassword !== "string" || url.origin !== "https://xoxy101031.itch.io") {
      feedback.textContent = messages.unavailable;
      return;
    }
    document.getElementById("download-link").href = url.href;
    accessCode.textContent = result.code;
    document.getElementById("download-password").textContent = result.downloadPassword;
    email.value = "";
    form.hidden = true;
    download.hidden = false;
    feedback.textContent = "";
  } catch {
    feedback.textContent = messages.unavailable;
  } finally {
    button.disabled = false;
  }
});

document.getElementById("copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(accessCode.textContent);
    feedback.textContent = "Game code copied.";
  } catch {
    feedback.textContent = "Select the game code above to copy it.";
  }
});
