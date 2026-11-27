use capybara_contracts::{RuntimeError, RuntimeErrorCode};
use std::fs::File;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::process::Command;

pub const LOCKED_MIHOMO_VERSION: &str = "v1.19.33";
pub const LOCKED_MIHOMO_SHA256: &str =
    "1cde41cfffd3de0aedad63c0a8515e1ce5eea507e8133aed0f637d316c93800a";

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VerifiedMihomoBinary {
    path: PathBuf,
    digest: String,
}

impl VerifiedMihomoBinary {
    /// Builds a verified binary from a digest the caller already checked.
    ///
    /// Used for an operator-supplied build, whose digest comes from the
    /// version index rather than the locked release.
    pub fn from_verified(path: PathBuf, digest: String) -> Self {
        Self { path, digest }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn digest(&self) -> &str {
        &self.digest
    }

    #[cfg(test)]
    pub(crate) fn test_fixture() -> Self {
        Self {
            path: PathBuf::from("mihomo-test.exe"),
            digest: LOCKED_MIHOMO_SHA256.to_owned(),
        }
    }
}

/// Hashes a file without comparing it to the locked release.
///
/// Registration of an operator-supplied build needs the digest, not a match.
pub fn sha256_file(path: &Path) -> Result<String, RuntimeError> {
    let mut file = File::open(path)
        .map_err(|error| core_error(format!("The Mihomo core could not be opened: {error}")))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| core_error(format!("The Mihomo core could not be read: {error}")))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher.finalize_hex())
}

pub fn verify_binary_file(path: &Path, expected_sha256: &str) -> Result<String, RuntimeError> {
    let expected = expected_sha256.trim().to_ascii_lowercase();
    if expected.len() != 64 || !expected.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(core_error("The locked Mihomo checksum is invalid."));
    }

    let mut file = File::open(path).map_err(|error| {
        core_error(format!(
            "The verified Mihomo core could not be opened: {error}"
        ))
    })?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];

    loop {
        let read = file.read(&mut buffer).map_err(|error| {
            core_error(format!(
                "The verified Mihomo core could not be read: {error}"
            ))
        })?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }

    let actual = hasher.finalize_hex();
    if actual != expected {
        return Err(core_error(
            "The Mihomo core checksum does not match the locked release.",
        ));
    }

    Ok(actual)
}

pub fn resolve_verified_binary(
    candidates: impl IntoIterator<Item = PathBuf>,
) -> Result<VerifiedMihomoBinary, RuntimeError> {
    for candidate in candidates {
        if !candidate.is_file() {
            continue;
        }

        match verify_binary_file(&candidate, LOCKED_MIHOMO_SHA256) {
            Ok(digest) => {
                verify_binary_version(&candidate)?;
                return Ok(VerifiedMihomoBinary {
                    path: candidate,
                    digest,
                });
            }
            Err(_) => continue,
        }
    }

    Err(core_error(
        "No verified Mihomo core was found. Install the locked release beside CapybaraProxy.",
    ))
}

pub fn verify_binary_version(path: &Path) -> Result<(), RuntimeError> {
    let output = Command::new(path)
        .arg("-v")
        .output()
        .map_err(|error| core_error(format!("The Mihomo core could not start: {error}")))?;
    let combined = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );

    if !output.status.success()
        || !combined
            .to_ascii_lowercase()
            .contains(&LOCKED_MIHOMO_VERSION.to_ascii_lowercase())
    {
        return Err(core_error(
            "The Mihomo core version does not match the locked release.",
        ));
    }

    Ok(())
}

pub(crate) fn random_hex(byte_count: usize) -> Result<String, RuntimeError> {
    let mut bytes = vec![0_u8; byte_count];
    fill_random(&mut bytes)?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn core_error(message: impl Into<String>) -> RuntimeError {
    RuntimeError::new(RuntimeErrorCode::CoreUnavailable, message, false)
}

pub(crate) fn map_io_error(context: &str, error: io::Error) -> RuntimeError {
    core_error(format!("{context}: {error}"))
}

#[cfg(windows)]
fn fill_random(buffer: &mut [u8]) -> Result<(), RuntimeError> {
    use std::ffi::c_void;
    use std::ptr;

    const BCRYPT_USE_SYSTEM_PREFERRED_RNG: u32 = 0x0000_0002;
    #[link(name = "bcrypt")]
    unsafe extern "system" {
        fn BCryptGenRandom(
            algorithm: *mut c_void,
            buffer: *mut u8,
            buffer_length: u32,
            flags: u32,
        ) -> i32;
    }

    let buffer_length = u32::try_from(buffer.len()).map_err(|_| random_error())?;
    let status = unsafe {
        BCryptGenRandom(
            ptr::null_mut(),
            buffer.as_mut_ptr(),
            buffer_length,
            BCRYPT_USE_SYSTEM_PREFERRED_RNG,
        )
    };
    if status < 0 {
        return Err(random_error());
    }
    Ok(())
}

#[cfg(unix)]
fn fill_random(buffer: &mut [u8]) -> Result<(), RuntimeError> {
    File::open("/dev/urandom")
        .and_then(|mut source| source.read_exact(buffer))
        .map_err(|_| random_error())
}

#[cfg(not(any(windows, unix)))]
fn fill_random(_buffer: &mut [u8]) -> Result<(), RuntimeError> {
    Err(random_error())
}

fn random_error() -> RuntimeError {
    RuntimeError::new(
        RuntimeErrorCode::Internal,
        "CapybaraProxy could not generate secure Runtime credentials.",
        true,
    )
}

const SHA256_INITIAL_STATE: [u32; 8] = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];

const SHA256_ROUND_CONSTANTS: [u32; 64] = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

struct Sha256 {
    state: [u32; 8],
    buffer: [u8; 64],
    buffer_len: usize,
    total_len: u64,
}

impl Sha256 {
    fn new() -> Self {
        Self {
            state: SHA256_INITIAL_STATE,
            buffer: [0_u8; 64],
            buffer_len: 0,
            total_len: 0,
        }
    }

    fn update(&mut self, mut bytes: &[u8]) {
        self.total_len = self.total_len.wrapping_add(bytes.len() as u64);

        if self.buffer_len > 0 {
            let needed = 64 - self.buffer_len;
            let copied = needed.min(bytes.len());
            self.buffer[self.buffer_len..self.buffer_len + copied]
                .copy_from_slice(&bytes[..copied]);
            self.buffer_len += copied;
            bytes = &bytes[copied..];
            if self.buffer_len == 64 {
                let block = self.buffer;
                self.compress(&block);
                self.buffer_len = 0;
            }
        }

        while bytes.len() >= 64 {
            let mut block = [0_u8; 64];
            block.copy_from_slice(&bytes[..64]);
            self.compress(&block);
            bytes = &bytes[64..];
        }

        if !bytes.is_empty() {
            self.buffer[..bytes.len()].copy_from_slice(bytes);
            self.buffer_len = bytes.len();
        }
    }

    fn finalize_hex(mut self) -> String {
        let bit_len = self.total_len.wrapping_mul(8);
        self.buffer[self.buffer_len] = 0x80;
        self.buffer_len += 1;

        if self.buffer_len > 56 {
            self.buffer[self.buffer_len..].fill(0);
            let block = self.buffer;
            self.compress(&block);
            self.buffer = [0_u8; 64];
        } else {
            self.buffer[self.buffer_len..56].fill(0);
        }

        self.buffer[56..64].copy_from_slice(&bit_len.to_be_bytes());
        let block = self.buffer;
        self.compress(&block);

        self.state
            .iter()
            .map(|word| format!("{word:08x}"))
            .collect()
    }

    fn compress(&mut self, block: &[u8; 64]) {
        let mut words = [0_u32; 64];
        for (index, chunk) in block.chunks_exact(4).take(16).enumerate() {
            words[index] = u32::from_be_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
        }
        for index in 16..64 {
            let s0 = words[index - 15].rotate_right(7)
                ^ words[index - 15].rotate_right(18)
                ^ (words[index - 15] >> 3);
            let s1 = words[index - 2].rotate_right(17)
                ^ words[index - 2].rotate_right(19)
                ^ (words[index - 2] >> 10);
            words[index] = words[index - 16]
                .wrapping_add(s0)
                .wrapping_add(words[index - 7])
                .wrapping_add(s1);
        }

        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut h] = self.state;
        for index in 0..64 {
            let choice = (e & f) ^ ((!e) & g);
            let majority = (a & b) ^ (a & c) ^ (b & c);
            let sum0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let sum1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let temp1 = h
                .wrapping_add(sum1)
                .wrapping_add(choice)
                .wrapping_add(SHA256_ROUND_CONSTANTS[index])
                .wrapping_add(words[index]);
            let temp2 = sum0.wrapping_add(majority);

            h = g;
            g = f;
            f = e;
            e = d.wrapping_add(temp1);
            d = c;
            c = b;
            b = a;
            a = temp1.wrapping_add(temp2);
        }

        self.state[0] = self.state[0].wrapping_add(a);
        self.state[1] = self.state[1].wrapping_add(b);
        self.state[2] = self.state[2].wrapping_add(c);
        self.state[3] = self.state[3].wrapping_add(d);
        self.state[4] = self.state[4].wrapping_add(e);
        self.state[5] = self.state[5].wrapping_add(f);
        self.state[6] = self.state[6].wrapping_add(g);
        self.state[7] = self.state[7].wrapping_add(h);
    }
}
