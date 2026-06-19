import { Router, type IRouter } from "express";
import healthRouter from "./health";
import botRouter from "./bot";
import accountRouter from "./account";
import infoRouter from "./info";

const router: IRouter = Router();

router.use(healthRouter);
router.use(botRouter);
router.use(accountRouter);
router.use(infoRouter);

export default router;
