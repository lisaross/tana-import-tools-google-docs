import { IConverter } from "../IConverter.js";
import { TanaIntermediateFile, TanaIntermediateNode } from "../../types/types.js";
import { authenticate, getDocsClient, getDriveClient } from "./auth.js";
import { drive_v3, docs_v1 } from "googleapis";
import { GaxiosResponse } from "gaxios";

// Type alias for Google Docs Document Schema
type GoogleDocsStructure = docs_v1.Schema$Document;

export class GoogleDocsConverter {
  private driveClient: drive_v3.Drive | null = null;
  private docsClient: docs_v1.Docs | null = null;

  // Helper to ensure clients are initialized
  private async ensureClientsInitialized() {
    if (!this.docsClient || !this.driveClient) {
      const authClient = await authenticate();
      if (!authClient) {
        throw new Error("Authentication failed. Please check GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables and run the auth flow.");
      }
      this.driveClient = getDriveClient(authClient);
      this.docsClient = getDocsClient(authClient);
      console.log("Google clients initialized.");
    }
  }

  async convert(inputIdentifier: string): Promise<TanaIntermediateFile | undefined> {
    await this.ensureClientsInitialized();

    if (!this.docsClient || !this.driveClient) {
      // Should not happen if ensureClientsInitialized worked, but check anyway
      console.error("Failed to initialize Google clients.");
      return undefined;
    }

    const inputId = this.extractId(inputIdentifier);
    if (!inputId) {
      console.error(`Invalid Google Doc/Folder URL or ID provided: ${inputIdentifier}`);
      return undefined;
    }

    const isFolder = await this.checkIfFolder(inputId);

    let docIds: string[] = [];
    if (isFolder) {
      console.log(`Input is a folder (${inputId}). Fetching document IDs...`);
      docIds = await this.getDocsFromFolder(inputId);
    } else {
      // Verify it's actually a document before proceeding
      const isDoc = await this.checkIfDoc(inputId);
      if (isDoc) {
          console.log(`Input is a document (${inputId}).`);
          docIds = [inputId];
      } else {
          console.error(`Input ID ${inputId} is neither a valid folder nor a document.`);
          return undefined;
      }
    }

    if (docIds.length === 0) {
      console.log("No Google Docs found to import.");
      // Return an empty Tana file structure
      return {
        version: "TanaIntermediateFile V0.1",
        summary: { leafNodes: 0, topLevelNodes: 0, totalNodes: 0, calendarNodes: 0, fields: 0, brokenRefs: 0 },
        nodes: [],
      };
    }

    console.log(`Found ${docIds.length} documents to process.`);

    const allNodes: TanaIntermediateNode[] = [];
    for (const docId of docIds) {
      console.log(`Processing document: ${docId}`);
      try {
        const docContent = await this.getDocumentContent(docId);
        if (docContent) {
          // Each doc becomes a top-level node in Tana
          const docNode = this.transformDocument(docContent);
          if (docNode) {
            allNodes.push(docNode);
          }
        }
      } catch (error) {
        console.error(`Error processing document ${docId}:`, error);
        // Optionally skip failed docs or halt execution
      }
    }

    const tanaFile: TanaIntermediateFile = {
      version: "TanaIntermediateFile V0.1",
      summary: { leafNodes: 0, topLevelNodes: 0, totalNodes: 0, calendarNodes: 0, fields: 0, brokenRefs: 0 }, // Calculated below
      nodes: allNodes,
      // attributes: [], // Optional
      // supertags: [], // Optional
    };

    this.calculateSummary(tanaFile);

    console.log("Conversion complete.");
    return tanaFile;
  }

  private extractId(input: string): string | null {
    // Try matching common Google Docs/Drive URL patterns
    const docRegex = /\/document\/d\/([a-zA-Z0-9_-]+)/;
    const folderRegex = /\/drive\/(?:folders|u\/\d+\/folders)\/([a-zA-Z0-9_-]+)/;

    const docMatch = input.match(docRegex);
    if (docMatch && docMatch[1]) {
      return docMatch[1];
    }

    const folderMatch = input.match(folderRegex);
    if (folderMatch && folderMatch[1]) {
      return folderMatch[1];
    }

    // If no URL match, assume it's a raw ID
    // Basic validation: Google IDs are typically alphanumeric strings > 20 chars
    if (input.match(/^[a-zA-Z0-9_-]{20,}$/)) {
      return input;
    }

    return null;
  }

  private async checkIfFolder(id: string): Promise<boolean> {
    if (!this.driveClient) throw new Error("Drive client not initialized");
    try {
      const response = await this.driveClient.files.get({
        fileId: id,
        fields: "mimeType",
      });
      return response.data.mimeType === "application/vnd.google-apps.folder";
    } catch (error: any) {
      // Handle specific errors like 404 Not Found
      if (error.response?.status === 404) {
          console.warn(`ID ${id} not found or insufficient permissions.`);
      } else {
          console.error(`Error checking type for ID ${id}:`, error.message);
      }
      return false; // Assume not a folder if check fails
    }
  }

  private async checkIfDoc(id: string): Promise<boolean> {
    if (!this.driveClient) throw new Error("Drive client not initialized");
    try {
      const response = await this.driveClient.files.get({
        fileId: id,
        fields: "mimeType",
      });
      return response.data.mimeType === "application/vnd.google-apps.document";
    } catch (error: any) {
      if (error.response?.status !== 404) {
          console.error(`Error checking document type for ID ${id}:`, error.message);
      }
      return false; // Assume not a doc if check fails or not found
    }
  }

  private async getDocsFromFolder(folderId: string): Promise<string[]> {
    if (!this.driveClient) throw new Error("Drive client not initialized");
    const docIds: string[] = [];
    let pageToken: string | undefined = undefined;
    try {
      do {
        const response: GaxiosResponse<drive_v3.Schema$FileList> = await this.driveClient.files.list({
          q: `"${folderId}" in parents and mimeType="application/vnd.google-apps.document" and trashed=false`,
          fields: "nextPageToken, files(id)",
          pageToken: pageToken,
          pageSize: 100, // Max 1000, but 100 is reasonable
        });
        if (response.data.files) {
          docIds.push(...response.data.files.map((file: drive_v3.Schema$File) => file.id!));
        }
        pageToken = response.data.nextPageToken ?? undefined;
      } while (pageToken);
    } catch (error: any) {
      console.error(`Error listing files in folder ${folderId}:`, error.message);
    }
    return docIds;
  }

  private async getDocumentContent(docId: string): Promise<GoogleDocsStructure | null> {
    if (!this.docsClient) throw new Error("Docs client not initialized");
    try {
      const response = await this.docsClient.documents.get({
        documentId: docId,
        // Request suggestionsHandlingMode if needed later
      });
      return response.data;
    } catch (error: any) {
      console.error(`Error fetching document ${docId}:`, error.message);
      return null;
    }
  }

  // --- Transformation Logic --- 

  private transformDocument(doc: GoogleDocsStructure): TanaIntermediateNode | null {
    if (!doc.documentId) return null;

    // Create a top-level node for the document itself
    const docNode: TanaIntermediateNode = {
        uid: `gdoc-${doc.documentId}`, // Use doc ID for uniqueness
        name: doc.title || "Untitled Google Doc",
        // Attempt to get timestamps from Drive API if needed (requires extra call/permissions)
        createdAt: Date.now(), // Placeholder
        editedAt: Date.now(), // Placeholder
        type: "node",
        children: [],
        supertags: ["google-doc"], // Add supertag to identify source
    };

    if (doc.body?.content) {
      docNode.children = this.transformElements(doc.body.content, doc.documentId);
    }

    return docNode;
  }

  private transformElements(elements: docs_v1.Schema$StructuralElement[], docId: string): TanaIntermediateNode[] {
    const nodes: TanaIntermediateNode[] = [];
    const listMap = new Map<string, { listNode: TanaIntermediateNode, items: Map<number, TanaIntermediateNode> }>();

    for (let i = 0; i < elements.length; i++) {
      const element = elements[i];
      const uidSuffix = `${docId}-${i}`;

      if (element.paragraph) {
        const paragraph = element.paragraph;
        const textContent = this.extractParagraphText(paragraph);
        const headingLevel = this.getHeadingLevel(paragraph);

        if (paragraph.bullet && paragraph.bullet.listId) {
          const listId = paragraph.bullet.listId;
          const nestingLevel = paragraph.bullet.nestingLevel ?? 0;

          const listItemNode: TanaIntermediateNode = {
            uid: `gdoc-li-${uidSuffix}`, 
            name: textContent || " ", // Use space if empty to avoid Tana issues
            createdAt: Date.now(),
            editedAt: Date.now(),
            type: "node",
            children: [],
          };

          if (!listMap.has(listId)) {
            // Create a parent node for the list if it doesn't exist
            const listParentNode: TanaIntermediateNode = {
                uid: `gdoc-list-${listId}-${docId}`,
                name: "List", // Placeholder name, maybe improve later
                createdAt: Date.now(),
                editedAt: Date.now(),
                type: "node",
                children: [],
                // supertags: ["list"] // Optional
            };
            listMap.set(listId, { listNode: listParentNode, items: new Map() });
            nodes.push(listParentNode); // Add list parent to the main nodes array
          }

          const listData = listMap.get(listId)!;
          listData.items.set(nestingLevel, listItemNode); // Track last item at this level

          // Find parent item (item at level nestingLevel - 1)
          if (nestingLevel > 0) {
            const parentItem = listData.items.get(nestingLevel - 1);
            if (parentItem) {
              parentItem.children = parentItem.children || [];
              parentItem.children.push(listItemNode);
            } else {
              // Parent not found (maybe list structure is weird), add to list root
              listData.listNode.children!.push(listItemNode);
            }
          } else {
            // Top-level list item, add to the list parent node
            listData.listNode.children!.push(listItemNode);
          }

        } else if (headingLevel !== null) {
            // Handle Headings
            const headingNode: TanaIntermediateNode = {
                uid: `gdoc-h${headingLevel}-${uidSuffix}`,
                name: textContent || `Heading ${headingLevel}`, 
                createdAt: Date.now(),
                editedAt: Date.now(),
                type: "node",
                children: [],
                supertags: [`h${headingLevel}`] // Use supertag for heading level
            };
            // Basic nesting: Assume subsequent non-heading paragraphs belong to the last heading
            // More complex nesting might require looking ahead or post-processing
            nodes.push(headingNode);

        } else if (textContent.trim()) { 
            // Handle regular paragraphs
            const paraNode: TanaIntermediateNode = {
                uid: `gdoc-para-${uidSuffix}`,
                name: textContent,
                createdAt: Date.now(),
                editedAt: Date.now(),
                type: "node",
            };
            // Simple approach: Add paragraph as a top-level node within the doc
            // Or, attach to the last heading? Needs refinement.
            const lastNode = nodes[nodes.length - 1];
            if (lastNode && lastNode.supertags?.some(tag => tag.startsWith("h"))) {
                // If last node was a heading, append paragraph as child
                lastNode.children = lastNode.children || [];
                lastNode.children.push(paraNode);
            } else {
                // Otherwise, add as a sibling
                nodes.push(paraNode);
            }
        }
        // Ignore empty paragraphs

      } else if (element.table) {
        // Handle Tables - Convert to Markdown table in description
        const markdownTable = this.transformTableToMarkdown(element.table);
        const tableNode: TanaIntermediateNode = {
            uid: `gdoc-table-${uidSuffix}`,
            name: "Table",
            createdAt: Date.now(),
            editedAt: Date.now(),
            type: "node",
            description: markdownTable, // Store Markdown in description
        };
        nodes.push(tableNode);

      } else if (element.sectionBreak) {
        // Optional: Could represent as a horizontal rule or ignore
        // const hrNode: TanaIntermediateNode = { uid: `gdoc-hr-${uidSuffix}`, name: "---", ... };
        // nodes.push(hrNode);
      } else if (element.tableOfContents) {
        // Ignore TOC for now
      }
    }

    return nodes;
  }

  private extractParagraphText(paragraph: docs_v1.Schema$Paragraph): string {
    let text = "";
    if (paragraph.elements) {
      for (const el of paragraph.elements) {
        if (el.textRun && el.textRun.content) {
            let content = el.textRun.content;
            // Apply basic markdown styling
            const style = el.textRun.textStyle;
            if (style) {
                if (style.link?.url) {
                    content = `[${content}](${style.link.url})`;
                } 
                // Apply styling in a specific order (e.g., bold/italic inside link is tricky)
                if (style.italic) content = `_${content}_`;
                if (style.bold) content = `**${content}**`;
                if (style.strikethrough) content = `~~${content}~~`;
                // TODO: Handle underline, highlight (Tana uses ^^highlight^^), code style?
            }
            text += content;
        } else if (el.inlineObjectElement?.inlineObjectId) {
            // Placeholder for inline images - requires fetching object properties
            text += ` [Image: ${el.inlineObjectElement.inlineObjectId}] `;
        } else if (el.pageBreak) {
            // Could represent as horizontal rule or ignore
            // text += "\n---\n";
        } else if (el.horizontalRule) {
            text += "\n---\n";
        }
        // TODO: Handle FootnoteReference, Equation, etc.
      }
    }
    // Google Docs uses vertical tab \v for newline sometimes?
    return text.replace(/[\v\r]/g, "\n").replace(/\n$/, ""); // Normalize newlines (vertical tab, carriage return) and remove trailing newline
  }

  private getHeadingLevel(paragraph: docs_v1.Schema$Paragraph): number | null {
      const styleType = paragraph.paragraphStyle?.namedStyleType;
      if (styleType?.startsWith("HEADING_")) {
          try {
              const level = parseInt(styleType.split("_")[1], 10);
              return isNaN(level) ? null : level;
          } catch (e) {
              return null;
          }
      }
      return null;
  }

  private transformTableToMarkdown(table: docs_v1.Schema$Table): string {
      let markdown = "";
      if (!table.tableRows) return "[Table data not extracted]";

      for (let i = 0; i < table.tableRows.length; i++) {
          const row = table.tableRows[i];
          let rowMarkdown = "|";
          if (row.tableCells) {
              for (const cell of row.tableCells) {
                  let cellText = " "; // Add padding
                  if (cell.content) {
                      // Extract text from cell content (which is a list of StructuralElement)
                      // Simple extraction for now, could be recursive
                      cellText += cell.content.map(el => {
                          if (el.paragraph) return this.extractParagraphText(el.paragraph);
                          return "";
                      }).join(" ").replace(/\n/g, "<br>"); // Replace newlines with <br> for Markdown tables
                  }
                  rowMarkdown += cellText + " |";
              }
          }
          markdown += rowMarkdown + "\n";

          // Add header separator after the first row
          if (i === 0) {
              markdown += "|" + (row.tableCells?.map(() => "---").join("|") || "") + "|\n";
          }
      }
      return markdown;
  }

  private calculateSummary(tanaFile: TanaIntermediateFile) {
    let leafNodes = 0;
    let totalNodes = 0;
    let calendarNodes = 0; // Example: check for date patterns or supertags
    let fields = 0; // Example: count nodes with descriptions or specific supertags

    function traverse(nodes: TanaIntermediateNode[]) {
      totalNodes += nodes.length;
      for (const node of nodes) {
        // Basic leaf node check
        if (!node.children || node.children.length === 0) {
          leafNodes++;
        }
        // Example calendar node check (adjust logic as needed)
        if (/^\d{4}-\d{2}-\d{2}$/.test(node.name)) { 
            calendarNodes++;
        }
        // Example field check
        if (node.description) {
            fields++;
        }

        if (node.children) {
          traverse(node.children);
        }
      }
    }

    traverse(tanaFile.nodes);

    tanaFile.summary.leafNodes = leafNodes;
    tanaFile.summary.totalNodes = totalNodes;
    tanaFile.summary.topLevelNodes = tanaFile.nodes.length; // Each doc is a top-level node
    tanaFile.summary.calendarNodes = calendarNodes;
    tanaFile.summary.fields = fields;
    tanaFile.summary.brokenRefs = 0; // Placeholder - implement if needed
  }
}

