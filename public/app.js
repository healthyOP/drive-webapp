let currentPath = "";
let currentItems = [];

let searchText = "";
let sortType = "name";
let viewMode = "grid";


const fileContainer = document.getElementById("file-container");
const emptyMessage = document.getElementById("empty-message");
const loading = document.getElementById("loading");

const backButton = document.getElementById("back-button");
const homeButton = document.getElementById("home-button");

const newFolderButton = document.getElementById("new-folder-button");
const fileInput = document.getElementById("file-input");

const searchInput = document.getElementById("search-input");
const sortSelect = document.getElementById("sort-select");

const gridViewButton = document.getElementById("grid-view-button");
const listViewButton = document.getElementById("list-view-button");

const breadcrumbs = document.getElementById("breadcrumbs");

const toast = document.getElementById("toast");
const previewModal = document.getElementById("preview-modal");
const previewTitle = document.getElementById("preview-title");
const previewContent = document.getElementById("preview-content");
const previewClose = document.getElementById("preview-close");
const previewDownload = document.getElementById("preview-download");

// -----------------------------
// Start the application
// -----------------------------

loadDirectory("");


// -----------------------------
// Load a directory
// -----------------------------

async function loadDirectory(path) {

    loading.classList.remove("hidden");
    fileContainer.innerHTML = "";
    emptyMessage.classList.add("hidden");

    try {

        const response = await fetch(
            `/api/files?path=${encodeURIComponent(path)}`
        );

        if (!response.ok) {
            const error = await getErrorMessage(response);
            showToast(error);
            return;
        }

        const data = await response.json();

        currentPath = data.path || "";
        currentItems = data.items;

        renderBreadcrumbs();
        renderFiles();

    } catch (error) {

        console.error(error);
        showToast("Could not connect to the server.");

    } finally {

        loading.classList.add("hidden");
    }
}

// -----------------------------
// Perview files
// -----------------------------
function previewFile(item) {

    const filePath = joinPath(currentPath, item.name);
    const previewUrl =
    `/api/preview?path=${encodeURIComponent(filePath)}`;

    const downloadUrl =
    `/api/download?path=${encodeURIComponent(filePath)}`;

    previewTitle.textContent = item.name;

    previewContent.innerHTML = `
        <div class="preview-loading">
            Loading preview...
        </div>
    `;

    previewModal.classList.remove("hidden");

    previewDownload.onclick = () => {
        window.location.href = downloadUrl;
    };

    const extension = getExtension(item.name);

    // Images
    if (
        extension === ".jpg" ||
        extension === ".jpeg" ||
        extension === ".png" ||
        extension === ".gif" ||
        extension === ".webp" ||
        extension === ".svg"
    ) {
        previewContent.innerHTML = `
            <img
                src="${previewUrl}"
                alt="${item.name}"
            >
        `;

        return;
    }

    // PDF
    if (extension === ".pdf") {
        previewContent.innerHTML = `
        <iframe
            src="${previewUrl}"
            title="${item.name}"
        ></iframe>
    `;

        return;
    }

    // Video
    if (
    extension === ".mp4" ||
    extension === ".webm" ||
    extension === ".ogg"
) {
    previewContent.innerHTML = `
        <video controls autoplay>
            <source src="${previewUrl}">
            Your browser does not support video playback.
        </video>
    `;

    return;
}

    // Audio
    if (
        extension === ".mp3" ||
        extension === ".wav" ||
        extension === ".ogg"
    ) {
        previewContent.innerHTML = `
            <audio controls autoplay>
                <source src="${url}">
                Your browser does not support audio playback.
            </audio>
        `;

        return;
    }

    // Text/code files
    if (
        extension === ".txt" ||
        extension === ".js" ||
        extension === ".css" ||
        extension === ".html" ||
        extension === ".json" ||
        extension === ".md"
    ) {
        fetch(previewUrl)
            .then(response => {
                if (!response.ok) {
                    throw new Error("Could not load file");
                }

                return response.text();
            })
            .then(text => {
                const pre = document.createElement("pre");

                pre.className = "preview-text";
                pre.textContent = text;

                previewContent.innerHTML = "";
                previewContent.appendChild(pre);
            })
            .catch(error => {
                console.error(error);

                previewContent.innerHTML = `
                    <div class="preview-unsupported">
                        Could not preview this file.
                        <br><br>
                        Use Download to open it.
                    </div>
                `;
            });

        return;
    }

    // Unsupported files
    previewContent.innerHTML = `
        <div class="preview-unsupported">
            <div style="font-size: 48px; margin-bottom: 15px;">
                📄
            </div>

            <div>
                Preview is not available for this file type.
            </div>

            <br>

            <button
                class="preview-button"
                onclick="window.location.href='${url}'"
            >
                ↓ Download file
            </button>
        </div>
    `;
}
// -----------------------------
// Render files
// -----------------------------

function renderFiles() {

    fileContainer.innerHTML = "";

    let items = [...currentItems];


    // Search
    if (searchText !== "") {

        items = items.filter(item =>
            item.name
                .toLowerCase()
                .includes(searchText.toLowerCase())
        );
    }


    // Sorting
    items.sort((a, b) => {

        if (sortType === "name") {
            return a.name.localeCompare(b.name);
        }

        if (sortType === "size") {
            return a.size - b.size;
        }

        if (sortType === "date") {
            return new Date(b.modified) - new Date(a.modified);
        }

    });


    if (items.length === 0) {

        emptyMessage.classList.remove("hidden");

        if (searchText !== "") {
            emptyMessage.textContent = "No files found.";
        } else {
            emptyMessage.textContent = "This folder is empty.";
        }

        return;
    }


    emptyMessage.classList.add("hidden");


    for (const item of items) {

        const element = createFileElement(item);

        fileContainer.appendChild(element);
    }
}


// -----------------------------
// Create one file/folder element
// -----------------------------

function createFileElement(item) {

    const element = document.createElement("div");

    element.className = "file-item";


    const icon = document.createElement("div");

    icon.className = "file-icon";
    icon.textContent = getFileIcon(item);


    const name = document.createElement("div");

    name.className = "file-name";
    name.textContent = item.name;


    const info = document.createElement("div");

    info.className = "file-info";

    if (item.isDirectory) {
        info.textContent = "Folder";
    } else {
        info.textContent = formatFileSize(item.size);
    }


    const buttons = document.createElement("div");

    buttons.className = "file-buttons";


    // Rename
    const renameButton = document.createElement("button");

    renameButton.textContent = "Rename";

    renameButton.addEventListener("click", (event) => {

        event.stopPropagation();

        renameItem(item);
    });


    // Delete
    const deleteButton = document.createElement("button");

    deleteButton.textContent = "Delete";

    deleteButton.addEventListener("click", (event) => {

        event.stopPropagation();

        deleteItem(item);
    });


    buttons.appendChild(renameButton);
    buttons.appendChild(deleteButton);


    element.appendChild(icon);
    element.appendChild(name);
    element.appendChild(info);
    element.appendChild(buttons);


    // Folder navigation
    if (item.isDirectory) {

        element.addEventListener("click", () => {

            const newPath = joinPath(currentPath, item.name);

            loadDirectory(newPath);
        });

    } else {

        element.addEventListener("dblclick", () => {

            previewFile(item);
        });
    }


    return element;
}


// -----------------------------
// Create a path
// -----------------------------

function joinPath(parent, child) {

    if (parent === "") {
        return child;
    }

    return `${parent}/${child}`;
}


// -----------------------------
// Breadcrumbs
// -----------------------------

function renderBreadcrumbs() {

    breadcrumbs.innerHTML = "";
    
    backButton.classList.toggle("hidden", currentPath === "");

    const home = document.createElement("button");

    home.textContent = "Home";

    home.addEventListener("click", () => {

        loadDirectory("");
    });

    breadcrumbs.appendChild(home);


    if (currentPath === "") {
        return;
    }


    const parts = currentPath.split("/");

    let builtPath = "";


    for (const part of parts) {

        builtPath = joinPath(builtPath, part);


        const separator = document.createElement("span");

        separator.textContent = " / ";

        breadcrumbs.appendChild(separator);


        const button = document.createElement("button");

        button.textContent = part;

        const pathForButton = builtPath;

        button.addEventListener("click", () => {

            loadDirectory(pathForButton);
        });


        breadcrumbs.appendChild(button);
    }
}


// -----------------------------
// File icon
// -----------------------------

function getFileIcon(item) {

    if (item.isDirectory) {
        return "📁";
    }


    const extension = getExtension(item.name);


    if (extension === ".jpg" ||
        extension === ".jpeg" ||
        extension === ".png" ||
        extension === ".gif") {

        return "🖼️";
    }


    if (extension === ".pdf") {
        return "📕";
    }


    if (extension === ".txt") {
        return "📄";
    }


    if (extension === ".js") {
        return "📜";
    }


    if (extension === ".html") {
        return "🌐";
    }


    if (extension === ".css") {
        return "🎨";
    }


    return "📄";
}


// -----------------------------
// Get extension
// -----------------------------

function getExtension(name) {

    const index = name.lastIndexOf(".");

    if (index === -1) {
        return "";
    }

    return name.substring(index).toLowerCase();
}


// -----------------------------
// Format file size
// -----------------------------

function formatFileSize(bytes) {

    if (bytes < 1024) {
        return `${bytes} B`;
    }

    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }

    if (bytes < 1024 * 1024 * 1024) {
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}


// -----------------------------
// Download
// -----------------------------

function downloadItem(item) {

    const path = joinPath(currentPath, item.name);

    window.location.href =
        `/api/download?path=${encodeURIComponent(path)}`;
}


// -----------------------------
// Delete
// -----------------------------

async function deleteItem(item) {

    const path = joinPath(currentPath, item.name);


    const confirmed = confirm(
        `Are you sure you want to delete "${item.name}"?`
    );


    if (!confirmed) {
        return;
    }


    try {

        const response = await fetch(
            `/api/delete?path=${encodeURIComponent(path)}`,
         {
            method: 'DELETE'
        })


        if (!response.ok) {

            const error = await getErrorMessage(response);

            showToast(error);

            return;
        }


        showToast("Deleted successfully.");

        await loadDirectory(currentPath);


    } catch (error) {

        console.error(error);

        showToast("Could not delete the item.");
    }
}


// -----------------------------
// Rename
// -----------------------------

async function renameItem(item) {

    const newName = prompt(
        "Enter the new name:",
        item.name
    );


    if (newName === null) {
        return;
    }


    if (newName.trim() === "") {

        showToast("Name cannot be empty.");

        return;
    }


    const path = joinPath(currentPath, item.name);


    try {

        const response = await fetch(
            "/api/rename",
            {
                method: "PATCH",

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({
                    path: path,
                    newName: newName
                })
            }
        );


        if (!response.ok) {

            const error = await getErrorMessage(response);

            showToast(error);

            return;
        }


        showToast("Renamed successfully.");

        await loadDirectory(currentPath);


    } catch (error) {

        console.error(error);

        showToast("Could not rename the item.");
    }
}


// -----------------------------
// Create folder
// -----------------------------

async function createFolder() {

    const name = prompt("Enter folder name:");


    if (name === null) {
        return;
    }


    if (name.trim() === "") {

        showToast("Folder name cannot be empty.");

        return;
    }


    try {

        const response = await fetch(
            "/api/folders",
            {
                method: "POST",

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({
                    path: currentPath,
                    name: name
                })
            }
        );


        if (!response.ok) {

            const error = await getErrorMessage(response);

            showToast(error);

            return;
        }


        showToast("Folder created.");

        await loadDirectory(currentPath);


    } catch (error) {

        console.error(error);

        showToast("Could not create folder.");
    }
}


// -----------------------------
// Upload
// -----------------------------

async function uploadFiles(files) {

    if (files.length === 0) {
        return;
    }


    const formData = new FormData();


    for (const file of files) {

        formData.append("files", file);
    }


    try {
        console.log("currentPath:", currentPath);

        console.log(
            "upload URL:",
            `/api/upload?path=${encodeURIComponent(currentPath)}`
        );
        const response = await fetch(
            `/api/upload?path=${encodeURIComponent(currentPath)}`,
            {
                method: "POST",
                body: formData
            }
        );


        if (!response.ok) {

            const error = await getErrorMessage(response);

            showToast(error);

            return;
        }


        showToast("Files uploaded successfully.");

        await loadDirectory(currentPath);


    } catch (error) {

        console.error(error);

        showToast("Upload failed.");
    }
}


// -----------------------------
// Error message
// -----------------------------

async function getErrorMessage(response) {

    try {

        const data = await response.json();

        return data.error || "Something went wrong.";

    } catch {

        return `Request failed (${response.status})`;
    }
}


// -----------------------------
// Toast
// -----------------------------

function showToast(message) {

    toast.textContent = message;

    toast.classList.add("show");


    setTimeout(() => {

        toast.classList.remove("show");

    }, 3000);
}


// -----------------------------
// Search
// -----------------------------

searchInput.addEventListener("input", () => {

    searchText = searchInput.value.trim();

    renderFiles();
});


// -----------------------------
// Sorting
// -----------------------------

sortSelect.addEventListener("change", () => {

    sortType = sortSelect.value;

    renderFiles();
});


// -----------------------------
// Navigation
// -----------------------------

backButton.addEventListener("click", () => {

    if (currentPath === "") {
        return;
    }


    const parts = currentPath.split("/");

    parts.pop();


    const parentPath = parts.join("/");

    loadDirectory(parentPath);
});


homeButton.addEventListener("click", () => {

    loadDirectory("");
});


// -----------------------------
// New folder
// -----------------------------

newFolderButton.addEventListener("click", () => {

    createFolder();
});


// -----------------------------
// Upload
// -----------------------------

fileContainer.addEventListener("dragover", (event) => {

    event.preventDefault();
});


fileContainer.addEventListener("drop", (event) => {

    event.preventDefault();

    uploadFiles(event.dataTransfer.files);
});


document.addEventListener("keydown", (event) => {

    if (event.ctrlKey && event.key === "u") {

        event.preventDefault();

        fileInput.click();
    }
});


fileInput.addEventListener("change", () => {

    uploadFiles(fileInput.files);

    fileInput.value = "";
});


// -----------------------------
// View mode
// -----------------------------

gridViewButton.addEventListener("click", () => {

    viewMode = "grid";

    fileContainer.classList.remove("list-view");

    gridViewButton.classList.add("active");
    listViewButton.classList.remove("active");
});


listViewButton.addEventListener("click", () => {

    viewMode = "list";

    fileContainer.classList.add("list-view");

    listViewButton.classList.add("active");
    gridViewButton.classList.remove("active");
});

const uploadButton = document.getElementById("upload-button");

uploadButton.addEventListener("click", () => {
    fileInput.click();
});

previewClose.addEventListener("click", () => {
    previewModal.classList.add("hidden");
    previewContent.innerHTML = "";
});

previewModal.querySelector(".preview-overlay").addEventListener("click", () => {
    previewModal.classList.add("hidden");
    previewContent.innerHTML = "";
});

document.addEventListener("keydown", (event) => {

    if (event.key === "Escape") {
        previewModal.classList.add("hidden");
        previewContent.innerHTML = "";
    }

});