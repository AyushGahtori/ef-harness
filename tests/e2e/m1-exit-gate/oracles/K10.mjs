const ACTIONS = {
  "kitchen.print": ["kitchen", "admin"],
  "order.create": ["customer", "kitchen", "admin"],
};
export function authorize(role, action) {
  const allowed = ACTIONS[action] ?? [];
  return { allowed: allowed.includes(role), role: role ?? "", action };
}
