// The mail a new clipper gets right after joining (William, 2026-11-18: "they should
// get the code by mail and link to dashboard and instructions that they should go
// safari click on that logo then that to add to homepage like real iphone logos").
export const DASHBOARD_URL = "https://quantativestudios.com/clippers";
export const ITCH_URL = "https://xoxy101031.itch.io/shredboundgame";
export const ITCH_CODE = "Shredbound10!";
export const WELCOME_SUBJECT = "You're approved: your Shredbound clipper code";

export function welcomeMailText(tiktok: string, code: string): string {
  return [
    `Hello @${tiktok},`,
    "",
    "You're approved as a Shredbound clipper, welcome 🙏🏼",
    "",
    "Your own code is",
    "",
    code,
    "",
    "Download the game through this link",
    ITCH_URL,
    "The code on itch to download is",
    ITCH_CODE,
    "",
    "Your code above is the code you enter in the game, and the only code you need to log in to your clipper dashboard:",
    DASHBOARD_URL,
    "",
    "Put the dashboard on your iPhone home screen like a real app:",
    "1. Open the link above in Safari.",
    "2. Tap the Share button (the square with the arrow up) at the bottom.",
    "3. Scroll down and tap \"Add to Home Screen\", then \"Add\".",
    "4. Open it from the Shredbound icon on your home screen and enter your code.",
    "",
    "The rule: post a TikTok at least every 3 days. If you play Shredbound and haven't posted for 3 days, your code stops working. Can't post for a while? Give a reason in the dashboard.",
    "",
    "Enjoy the art of Shredbound brother! ❤️",
    "",
    "/Shredbound team",
  ].join("\n");
}
