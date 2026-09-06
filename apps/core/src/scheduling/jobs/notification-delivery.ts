import { deliverNotifications } from "../../notifications/application/deliver-notifications";
import { projectDomainNotifications } from "../../notifications/application/project-domain-notifications";
import { publishNotificationOutbox } from "../../notifications/application/notification-queue";
import type { ScheduledJob } from "../types";

export const notificationDeliveryJob: ScheduledJob = {
  name: "notifications.delivery",
  async run({ database, emailDelivery, notificationQueue, now }) {
    const projected = await projectDomainNotifications(database, now);
    if (notificationQueue) {
      const publication = await publishNotificationOutbox(database, notificationQueue, now);
      return {
        status: "SUCCEEDED",
        affected: projected + publication.published,
        detail: `${projected} projected, ${publication.attempted} publication attempts, ${publication.published} published`,
      };
    }
    const delivery = await deliverNotifications(database, emailDelivery, now);
    return {
      status: "SUCCEEDED",
      affected: projected + delivery.delivered,
      detail: `${projected} projected, ${delivery.attempted} attempted, ${delivery.delivered} delivered`,
    };
  },
};
