# Tana Import Tools - Google Docs Converter

This document describes how to set up and use the Google Docs converter, which is part of the `tana-import-tools` project.

## Prerequisites

1.  **Node.js:** Install Node.js (version 18 or later recommended). You can download it from [https://nodejs.org/](https://nodejs.org/).
2.  **Yarn:** Install Yarn package manager. Follow the instructions at [https://yarnpkg.com/getting-started/install](https://yarnpkg.com/getting-started/install). Ensure Corepack is enabled by running `corepack enable` in your terminal.
3.  **Google Cloud Project & OAuth Credentials:**
    *   You need a Google Cloud project. If you don't have one, create one at [https://console.cloud.google.com/](https://console.cloud.google.com/).
    *   Enable the **Google Drive API** and **Google Docs API** for your project.
    *   Create OAuth 2.0 Client ID credentials for a **Web application**.
        *   Go to APIs & Services > Credentials > Create Credentials > OAuth client ID.
        *   Select "Web application" as the application type.
        *   Add `http://localhost:3000/oauth2callback` to the **Authorized redirect URIs**.
        *   Note down the **Client ID** and **Client Secret**. You will need these later.

## Installation

1.  **Clone the Repository:**
    ```bash
    git clone https://github.com/tanainc/tana-import-tools.git
    cd tana-import-tools
    ```
    *(Note: This assumes you will clone the official repository. Since I have modified the code, I will provide the modified code as a zip file instead. You will need to unzip it and navigate into the directory.)*

2.  **Install Dependencies:**
    ```bash
    yarn install
    ```

## Configuration

1.  **Set Environment Variables:** The tool requires your Google API Client ID and Client Secret to be set as environment variables. Set them in your terminal session or add them to your shell profile (`.bashrc`, `.zshrc`, etc.):
    ```bash
    export GOOGLE_CLIENT_ID="YOUR_CLIENT_ID"
    export GOOGLE_CLIENT_SECRET="YOUR_CLIENT_SECRET"
    ```
    Replace `YOUR_CLIENT_ID` and `YOUR_CLIENT_SECRET` with the values you obtained from the Google Cloud Console.

## First-Time Authorization

The first time you run the Google Docs converter, it will initiate an OAuth 2.0 authorization flow:

1.  It will print a URL to your console.
2.  Copy this URL and paste it into your web browser.
3.  Log in with the Google account that has access to the Docs/Folders you want to import.
4.  Grant the application permission to access your Google Drive (read-only) and Google Docs (read-only).
5.  After granting permission, you will be redirected to `http://localhost:3000/oauth2callback`. You should see a success message in your browser, and the tool will continue running in the terminal.
6.  A `token.json` file will be created in the `tana-import-tools/dist/converters/google-docs/` directory to store the authorization token for future use. You won't need to re-authorize unless the token expires or is revoked.

## Usage

1.  **Build the Project:** Compile the TypeScript code:
    ```bash
    yarn build
    ```

2.  **Run the Converter:** Use the following command format:
    ```bash
    node dist/runner.js google-docs <google_doc_or_folder_url_or_id>
    ```
    Replace `<google_doc_or_folder_url_or_id>` with:
    *   The full URL of a Google Doc (e.g., `https://docs.google.com/document/d/123abcXYZ.../edit`)
    *   The ID of a Google Doc (the long string in the URL, e.g., `123abcXYZ...`)
    *   The full URL of a Google Drive Folder (e.g., `https://drive.google.com/drive/folders/456defUVW...`)
    *   The ID of a Google Drive Folder (the long string in the URL, e.g., `456defUVW...`)

3.  **Output:** The tool will process the specified document(s) and generate a Tana Intermediate Format file named like `google-docs-import-TIMESTAMP.tif.json` in the `tana-import-tools` directory.

4.  **Import into Tana:** Go to your Tana workspace, open the command line (Cmd/Ctrl+K), type "Import data from file", and select the generated `.tif.json` file.

## Structure Preservation Notes

*   **Headings:** Headings (H1, H2, etc.) are converted into Tana nodes with corresponding supertags (`#h1`, `#h2`, etc.). Paragraphs immediately following a heading are nested under that heading node.
*   **Lists:** Bulleted and numbered lists are converted into nested Tana nodes. The hierarchy of nested lists should be preserved.
*   **Paragraphs:** Regular paragraphs become individual Tana nodes.
*   **Tables:** Tables are converted into a single Tana node with the table content represented as a Markdown table within the node's description field.
*   **Basic Formatting:** Bold, italics, strikethrough, and links within text are converted to their Tana Markdown equivalents (`**bold**`, `_italic_`, `~~strikethrough~~`, `[link text](URL)`).
*   **Other Elements:** Images, page breaks, horizontal rules, and other complex elements might be represented as placeholders or ignored.

## Workspace Organization

When you import your Google Docs content into Tana, please note:

*   The import will create a new workspace containing your imported content
*   All imported nodes will be placed in that workspace's Library, NOT on the home page
*   The workspace may appear empty at first glance, but all your content is safely stored in the Library
*   While the formatting may not be perfect, this method is significantly more efficient than manually copying and pasting each document
*   Using Tana's paste functionality directly would likely result in formatting issues, making this import tool a faster, if not better alternative

## Troubleshooting

*   **`EADDRINUSE` Error:** If you get an error indicating port 3000 is already in use during authorization, make sure no other application is using that port and try again.
*   **Authentication Errors:** Double-check that your Client ID and Client Secret are correct and set as environment variables. Ensure the redirect URI `http://localhost:3000/oauth2callback` is correctly configured in the Google Cloud Console.
*   **API Errors:** Ensure the Google Drive and Google Docs APIs are enabled in your Google Cloud project. Check that the account you authorize with has permission to view the specified documents/folders.
*   **Build Errors:** Ensure you have the correct Node.js and Yarn versions installed and run `yarn install` before `yarn build`.

