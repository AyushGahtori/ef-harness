export function isAcceptingOrders(isoInstant) {
  const stamp = new Date(isoInstant);
  const hour = stamp.getUTCHours();
  const minute = stamp.getUTCMinutes();
  const second = stamp.getUTCSeconds();
  const local = hour * 3600 + minute * 60 + second;
  return local < 10 * 3600 + 45 * 60;
}
