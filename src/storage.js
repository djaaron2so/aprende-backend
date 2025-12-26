import path from "path";
import fs from "fs";

router.get("/beats/:id.mp3", requireAuth, (req, res) => {
    const id = req.params.id;

    const candidates = [
        path.join(process.cwd(), "public", "beats", `${id}.mp3`),
        path.join(process.cwd(), "storage", `${id}.mp3`),
    ];

    const filePath = candidates.find(p => fs.existsSync(p));

    if (!filePath) return res.status(404).json({ error: "MP3 not found" });

    res.sendFile(filePath);
});
