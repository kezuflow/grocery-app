import { deliverNotifications } from "../../notifications/application/deliver-notifications";
import { projectDomainNotifications } from "../../notifications/application/project-domain-notifications";
import { disabledEmailDeliveryPort } from "../../notifications/infrastructure/email-delivery-port";
import type { ScheduledJob } from "../types";

export const notificationDeliveryJob: ScheduledJob = {
  name: "notifications.delivery",
  async run({ database, now }) {
    const projected = await projectDomainNotifications(database, now);
    const delivery = await deliverNotifications(database, disabledEmailDeliveryPort, now);
    return {
      status: "SUCCEEDED",
      affected: projected + delivery.delivered,
      detail: `${projected} projected, ${delivery.attempted} attempted, ${delivery.delivered} delivered`,
    };
  },
};
