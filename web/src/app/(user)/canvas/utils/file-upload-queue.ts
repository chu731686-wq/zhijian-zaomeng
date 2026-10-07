const MAX_CONCURRENT_UPLOADS = 3;
let activeUploads = 0;
const waitingUploads: Array<() => void> = [];

async function acquireUploadSlot() {
    if (activeUploads < MAX_CONCURRENT_UPLOADS) {
        activeUploads += 1;
        return;
    }
    await new Promise<void>((resolve) => waitingUploads.push(resolve));
}

function releaseUploadSlot() {
    const next = waitingUploads.shift();
    if (next) next();
    else activeUploads -= 1;
}

export async function queueFileUpload<T>(upload: () => Promise<T>): Promise<T> {
    await acquireUploadSlot();
    try {
        return await upload();
    } finally {
        releaseUploadSlot();
    }
}
