import { Router } from "express";
import * as controller from "./file.controller";
import { requireInternalKey } from "../../middlewares/internal.middleware";
import { requireFileAccess } from "./file.access";

const router = Router();

/**
 * Application documents: a licence, vehicle papers, a trade certificate.
 *
 * Only the storefront may store one — it holds the internal key, and it is the
 * only thing that has already checked that the person uploading is signed in.
 *
 * Reading needs a valid link: the `sig` the upload response puts on the URL, or
 * a store-team token. A bare id is never enough, because the document is
 * somebody's identity and the id is guessable.
 */

// The filename is part of the path so the browser can see the extension.
// Express 5 dropped the `/:name?` shorthand, so the bare id is its own route.
router.get("/:id/:name", requireFileAccess, controller.getFile);
router.get("/:id", requireFileAccess, controller.getFile);

router.post("/", requireInternalKey, controller.uploadFile);

export default router;
