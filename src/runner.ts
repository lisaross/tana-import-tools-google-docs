import { exit } from "process";
import * as fs from "fs";

import { TanaIntermediateFile } from "./types/types.js";
import { RoamConverter } from "./converters/roam/index.js";
import { WorkflowyConverter } from "./converters/workflowy/index.js";
import { LogseqConverter } from "./converters/logseq/index.js";
import { GoogleDocsConverter } from "./converters/google-docs/index.js";

async function runConversion() {
  const fileType = process.argv[2];
  // For Google Docs, process.argv[3] is the URL or ID, not a local file path
  const inputIdentifier = process.argv[3]; 

  if (!fileType) {
    console.log("No file type provided");
    exit(0);
  }

  if (!inputIdentifier) {
    console.log("No file path or Google Doc/Folder identifier provided");
    exit(0);
  }

  const supportedTypes = ["roam", "workflowy", "logseq", "google-docs"];
  if (!supportedTypes.includes(fileType)) {
    console.log(`File type: ${fileType} is not supported`);
    exit(0);
  }

  let contents = "";
  if (fileType !== "google-docs") {
    console.log(`\n\nReading file: ${inputIdentifier} for import as: ${fileType}`);
    try {
        contents = fs.readFileSync(inputIdentifier, "utf8");
        console.log("File length:", contents.length);
    } catch (err) {
        console.error(`Error reading file ${inputIdentifier}:`, err);
        exit(1);
    }
  } else {
      console.log(`\n\nProcessing Google Doc/Folder: ${inputIdentifier} for import as: ${fileType}`);
      // Content for Google Docs is fetched within the converter
  }


  function saveFile(fileName: string, tanaIntermediteNodes: TanaIntermediateFile) {
    // Use a generic output name or derive from input if possible
    const baseName = fileType === "google-docs" ? `google-docs-import-${Date.now()}` : fileName;
    const targetFileName = `${baseName}.tif.json`;
    try {
        fs.writeFileSync(targetFileName, JSON.stringify(tanaIntermediteNodes, null, 2));
        console.log(`Tana Intermediate Nodes written to : ${targetFileName}`);
    } catch (err) {
        console.error(`Error writing output file ${targetFileName}:`, err);
        exit(1);
    }
  }

  let tanaIntermediteFile: TanaIntermediateFile | undefined = undefined;
  try {
    switch (fileType) {
      case "roam":
        tanaIntermediteFile = new RoamConverter().convert(contents);
        break;
      case "workflowy":
        tanaIntermediteFile = new WorkflowyConverter().convert(contents);
        break;
      case "logseq":
        tanaIntermediteFile = new LogseqConverter().convert(contents);
        break;
      case "google-docs":
        // Pass the identifier (URL/ID) directly to the converter
        tanaIntermediteFile = await new GoogleDocsConverter().convert(inputIdentifier);
        break;
      default:
        // This case should not be reached due to the check above
        console.log(`File type ${fileType} is not supported`);
        exit(0);
    }
  } catch (error) {
      console.error(`Error during conversion for type ${fileType}:`, error);
      exit(1);
  }

  if (!tanaIntermediteFile) {
    console.log("Conversion resulted in no Tana nodes.");
    // Don't exit immediately, maybe it was an empty folder/doc
    // exit(0); 
  } else {
    console.dir(tanaIntermediteFile.summary);
    saveFile(inputIdentifier, tanaIntermediteFile);
  }

  console.log("\nConversion process finished.");
}

// Execute the async function
runConversion().catch(error => {
    console.error("Unhandled error in runConversion:", error);
    exit(1);
});

