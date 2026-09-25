export const WELCOME_CAMPAIGN_ID = "welcome-freshmarkets";
export const WELCOME_CAMPAIGN_REVISION = "2";

export type AnnouncementPage = {
  id: string;
  title: string;
  body: string;
  actionLabel: string;
};

export function welcomeAnnouncementPages(): readonly AnnouncementPage[] {
  return [
    {
      id: "welcome",
      title: "Welcome to FreshMarkets",
      body: "We're accepting scheduled orders Monday through Friday for delivery on Saturday or Sunday. Stay tuned for updates on instant delivery.",
      actionLabel: "Shop fresh picks",
    },
  ];
}
