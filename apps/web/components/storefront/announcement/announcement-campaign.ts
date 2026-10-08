export const WELCOME_CAMPAIGN_ID = "welcome-freshmarkets";
export const WELCOME_CAMPAIGN_REVISION = "6";

export type AnnouncementBodySegment = {
  text: string;
  emphasis?: boolean;
};

export type AnnouncementPage = {
  id: string;
  title: string;
  body: readonly AnnouncementBodySegment[];
  actionLabel: string;
  action: "catalog" | "delivery-address";
  image: { src: string; alt: string };
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
      action: "catalog",
      image: {
        src: "/announcements/welcome-market-scene.webp",
        alt: "Smiling FreshMarkets shopper holding a branded produce bag in a supermarket",
      },
    },
    {
      id: "delivery-address",
      title: "Set your delivery address",
      body: [
        {
          text: "Set your address to see local prices and place an order.",
        },
      ],
      actionLabel: "Set delivery address",
      action: "delivery-address",
      image: {
        src: "/announcements/welcome-delivery-address-v1.webp",
        alt: "FreshMarkets shopper setting a delivery location on a phone with a green home pin",
      },
    },
  ];
}
