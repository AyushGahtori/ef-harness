export const M1_VIEWER_MOUNT_ID = "m1-viewer";

export const M1_CONTENT_SECURITY_POLICY =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export const M1_TASK_PATH = ["LEASED", "CODING", "STATIC_AUDIT", "CLEAN_VERIFY", "ACCEPTED"] as const;

/** Task 122 mounts the full shell on `#m1-viewer`. This page is the M1 diff and receipt view. */
export const M1_VIEWER_DOCUMENT = "index.html";
