const ORDERS = [
  { id: "o-1", customer: "Acme, Inc.", total: 45, status: "paid" },
  { id: "o-2", customer: "Beta Ltd", total: 12, status: "paid" },
  { id: "o-3", customer: "Gamma Co", total: 99, status: "pending" }
];

export function filteredOrders({ status, minTotal = 0 } = {}) {
  return ORDERS.filter((order) => (!status || order.status === status) && order.total >= minTotal);
}
