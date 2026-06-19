import { Router, type IRouter } from "express";
import healthRouter from "./health";
import botRouter from "./bot";
import accountRouter from "./account";

const router: IRouter = Router();

router.use(healthRouter);
router.use(botRouter);
router.use(accountRouter);

export default router;
