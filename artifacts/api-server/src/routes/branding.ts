import { Router, type IRouter } from "express";
import { GetBrandingResponse, GetAdminBrandingResponse, UpdateAdminBrandingBody, UpdateAdminBrandingResponse, SetAdminBrandingLogoUrlBody } from "@workspace/api-zod";
import { currentAdmin } from "../lib/currentUser";
import { adminBranding, brandLogoFile, changeBranding, clearBrandLogo, publicBranding, setBrandLogo, setBrandLogoFromUrl } from "../lib/branding";
import { receiveFile, sendFile } from "../lib/uploads";

/** Public (no sign-in): the sign-in pages show the name, colour and logo too. Mounted before authentication. */
export const publicBrandingRouter: IRouter = Router();
publicBrandingRouter.get("/branding", async (_req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-cache");
  res.json(GetBrandingResponse.parse(await publicBranding()));
});
publicBrandingRouter.get("/branding/logo", async (req, res): Promise<void> => {
  await sendFile(req, res, await brandLogoFile());
});

/** Admin Settings → Branding. */
const router: IRouter = Router();
router.get("/admin/branding", async (_req, res): Promise<void> => {
  res.json(GetAdminBrandingResponse.parse(await adminBranding()));
});
router.put("/admin/branding", async (req, res): Promise<void> => {
  const input = UpdateAdminBrandingBody.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: "Give the application a name of 2–40 characters and choose a colour." }); return; }
  res.json(UpdateAdminBrandingResponse.parse(await changeBranding(input.data, currentAdmin(req))));
});
router.post("/admin/branding/logo", receiveFile, async (req, res): Promise<void> => {
  res.json(GetAdminBrandingResponse.parse(await setBrandLogo(req.file, currentAdmin(req))));
});
router.post("/admin/branding/logo-url", async (req, res): Promise<void> => {
  const input = SetAdminBrandingLogoUrlBody.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: "Enter the image link (up to 2,000 characters)." }); return; }
  res.json(GetAdminBrandingResponse.parse(await setBrandLogoFromUrl(input.data.url, currentAdmin(req))));
});
router.delete("/admin/branding/logo", async (req, res): Promise<void> => {
  res.json(GetAdminBrandingResponse.parse(await clearBrandLogo(currentAdmin(req))));
});

export default router;
