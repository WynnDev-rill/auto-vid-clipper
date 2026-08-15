import fs from "node:fs";

const activityPath = "android/app/src/main/java/com/wynndev/clipforge/MainActivity.java";
if (!fs.existsSync(activityPath)) throw new Error("Generated MainActivity.java not found");
let source = fs.readFileSync(activityPath, "utf8");
source = source.replace(/^            } catch \(Exception error\) \{.*$/m, '            } catch (Exception error) { sourceStates.put(id, "{\\\"status\\\":\\\"error\\\",\\\"error\\\":\\\"Source download failed\\\"}"); }');
fs.writeFileSync(activityPath, source);
console.log("Patched generated ClipForge Java error state safely.");
