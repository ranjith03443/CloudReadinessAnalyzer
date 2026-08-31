// Demo role switcher — NOT access control. There is no login: the client
// declares which role it's acting as on every request via a header, and this
// module gates architect-only routes on that declaration. Anyone can flip the
// header/UI toggle. Real credential-backed auth (sessions, passwords, RBAC
// tied to an identity) is a named Pilot-phase item — this exists only to let
// the RBAC/governance *concept* be demoed without login friction. The
// middleware shape (requireRole) mirrors what a real auth check would look
// like, so swapping in real auth later doesn't change call sites.
const VALID_ROLES = ["architect", "viewer"];
const DEFAULT_ROLE = "viewer";

export function getActingRole(req) {
  const header = req.get("X-Acting-Role");
  return VALID_ROLES.includes(header) ? header : DEFAULT_ROLE;
}

export function requireRole(role) {
  return (req, res, next) => {
    const acting = getActingRole(req);
    if (acting !== role) {
      return res.status(403).json({
        error: `This action requires the "${role}" role. Switch roles in the header to continue.`,
      });
    }
    next();
  };
}
