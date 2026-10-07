export const WELCOME_CAMPAIGN_ID = "welcome-freshmarkets";
export const WELCOME_CAMPAIGN_REVISION = "4";

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
        { text: "Order cutoff is " },
        { text: "Thursday", emphasis: true },
        { text: " for delivery on " },
        { text: "Friday", emphasis: true },
        { text: ". Stay tuned for updates on instant delivery." },
      ],
      actionLabel: "Shop fresh picks",
    },
    {
      id: "delivery-address",
      title: "Set your delivery address",
      body: [
        {
          text: "Make sure to set your delivery address to use the app and place an order. Tap Deliver to at the top to get started.",
        },
      ],
      actionLabel: "Shop fresh picks",
    },
  ];
}
