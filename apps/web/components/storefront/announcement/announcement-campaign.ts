import type { StorefrontAnnouncementSchedule } from "@freshmarkets/contracts";

export const WELCOME_CAMPAIGN_ID = "welcome-freshmarkets";
export const WELCOME_CAMPAIGN_REVISION = "1";
export const ANNOUNCEMENT_COOKIE = "fm_announcement_seen";
export const WELCOME_CAMPAIGN_KEY = `${WELCOME_CAMPAIGN_ID}:${WELCOME_CAMPAIGN_REVISION}`;

export type AnnouncementPage = {
  id: string;
  eyebrow: string;
  title: string;
  body: string;
  note: string;
  actionLabel: string;
};

export function welcomeAnnouncementPages(
  schedule: StorefrontAnnouncementSchedule,
): readonly AnnouncementPage[] {
  const weeklySunday = schedule === "MONDAY_FRIDAY_SUNDAY";
  return [
    {
      id: "welcome",
      eyebrow: "Fresh goodness, on your schedule",
      title: "Welcome to FreshMarkets",
      body: weeklySunday
        ? "Make room for more of the good stuff. Shop your market favorites Monday through Friday, and we'll bring your fresh picks straight to your door on Sunday. Fill your bag with the ingredients for a delicious week ahead."
        : "Make room for more of the good stuff. Explore fresh market favorites and choose the available delivery option at checkout. Fill your bag with the ingredients for a delicious week ahead.",
      note: "Delivery availability, arrival time and fees are confirmed at checkout.",
      actionLabel: "Shop this week's picks",
    },
  ];
}
