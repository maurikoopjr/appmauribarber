const fs = require('fs');
const readline = require('readline');

const path = "C:\\Users\\mauri koop junior\\.gemini\\antigravity\\brain\\2601fc49-a0cb-42f2-ac34-0bc2968a25f7\\.system_generated\\logs\\transcript.jsonl";
const outPath = "C:\\Users\\mauri koop junior\\.gemini\\antigravity\\scratch\\barbearia_deploy\\app_recovered.js";

async function processLineByLine() {
  const fileStream = fs.createReadStream(path);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let latestContent = "";

  for await (const line of rl) {
    if (line.includes('app.js') && line.includes('write_to_file')) {
      try {
        const obj = JSON.parse(line);
        if (obj.tool_calls) {
          for (const call of obj.tool_calls) {
            if (call.name === "default_api:write_to_file" || call.name === "write_to_file") {
              const args = JSON.parse(call.arguments);
              if (args.TargetFile && args.TargetFile.endsWith("app.js")) {
                latestContent = args.CodeContent;
              }
            }
          }
        }
      } catch (e) {
        // ignore
      }
    }
  }

  if (latestContent) {
    fs.writeFileSync(outPath, latestContent);
    console.log("Successfully extracted app.js");
  } else {
    console.log("Could not find app.js content in transcript.");
  }
}

processLineByLine();
