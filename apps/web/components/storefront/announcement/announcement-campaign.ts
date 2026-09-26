export const WELCOME_CAMPAIGN_ID = "welcome-freshmarkets";
export const WELCOME_CAMPAIGN_REVISION = "3";

export type AnnouncementBodySegment = {
  text: string;
  emphasis?: boolean;
};

export type AnnouncementPage = {
  id: string;
  title: string;
  body: readonly AnnouncementBodySegment[];
  actionLabel: string;
};

export function welcomeAnnouncementPages(): readonly AnnouncementPage[] {
  return [
    {
      id: "welcome",
      title: "Welcome to FreshMarkets",
      body: [
        { text: "We're accepting scheduled orders " },
        { text: "Monday - Friday", emphasis: true },
        { text: " for delivery on " },
        { text: "Saturday -Sunday", emphasis: true },
        { text: ". Stay tuned for updates on instant delivery." },
      ],
      actionLabel: "Shop fresh picks",
    },
  ];
}
