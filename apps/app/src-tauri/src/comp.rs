// The Telly-way composition spike (Windows only).
//
// Step 1: prove DirectComposition can put a GPU layer over the Tauri window.
// We make a composition swapchain, clear it to a semi-transparent blue, and show
// it via a DComp target on the window HWND. If a blue tint appears over the app,
// the DComp foundation works — next we swap the colour for the WebView2 visual
// (transparent, controls) and an mpv child window beneath it.

#![cfg(windows)]

use std::ffi::c_void;
use std::sync::Mutex;
use windows::core::Interface;
use windows::Win32::Foundation::{HMODULE, HWND};
use windows::Win32::Graphics::Direct3D::{D3D_DRIVER_TYPE_HARDWARE, D3D_FEATURE_LEVEL};
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11RenderTargetView,
    ID3D11Texture2D, D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_SDK_VERSION,
};
use windows::Win32::Graphics::DirectComposition::{
    DCompositionCreateDevice, IDCompositionDevice, IDCompositionTarget, IDCompositionVisual,
};
use windows::Win32::Graphics::Dxgi::Common::{DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_SAMPLE_DESC};
use windows::Win32::Graphics::Dxgi::{
    CreateDXGIFactory2, IDXGIDevice, IDXGIFactory2, IDXGISwapChain1, DXGI_ALPHA_MODE_PREMULTIPLIED,
    DXGI_CREATE_FACTORY_FLAGS, DXGI_SCALING_STRETCH, DXGI_SWAP_CHAIN_DESC1,
    DXGI_SWAP_EFFECT_FLIP_SEQUENTIAL, DXGI_USAGE_RENDER_TARGET_OUTPUT,
};

// Keep the COM objects alive (else the composition vanishes when they drop).
struct Comp {
    _device: ID3D11Device,
    _context: ID3D11DeviceContext,
    _swap: IDXGISwapChain1,
    _dcomp: IDCompositionDevice,
    _target: IDCompositionTarget,
    _visual: IDCompositionVisual,
}
// Created + used only on the UI thread; the Mutex just keeps it alive.
unsafe impl Send for Comp {}
static COMP: Mutex<Option<Comp>> = Mutex::new(None);

pub fn color_test(hwnd: isize, w: u32, h: u32) -> Result<(), String> {
    unsafe {
        let hwnd = HWND(hwnd as *mut c_void);

        // D3D11 device (BGRA support is required for DComp).
        let mut device: Option<ID3D11Device> = None;
        let mut context: Option<ID3D11DeviceContext> = None;
        let mut level = D3D_FEATURE_LEVEL::default();
        D3D11CreateDevice(
            None,
            D3D_DRIVER_TYPE_HARDWARE,
            HMODULE::default(),
            D3D11_CREATE_DEVICE_BGRA_SUPPORT,
            None,
            D3D11_SDK_VERSION,
            Some(&mut device),
            Some(&mut level),
            Some(&mut context),
        )
        .map_err(|e| format!("D3D11CreateDevice: {e}"))?;
        let device = device.ok_or("no d3d11 device")?;
        let context = context.ok_or("no d3d11 context")?;

        let dxgi_device: IDXGIDevice =
            device.cast().map_err(|e| format!("cast IDXGIDevice: {e}"))?;
        let factory: IDXGIFactory2 = CreateDXGIFactory2(DXGI_CREATE_FACTORY_FLAGS(0))
            .map_err(|e| format!("CreateDXGIFactory2: {e}"))?;

        let desc = DXGI_SWAP_CHAIN_DESC1 {
            Width: w.max(1),
            Height: h.max(1),
            Format: DXGI_FORMAT_B8G8R8A8_UNORM,
            SampleDesc: DXGI_SAMPLE_DESC {
                Count: 1,
                Quality: 0,
            },
            BufferUsage: DXGI_USAGE_RENDER_TARGET_OUTPUT,
            BufferCount: 2,
            Scaling: DXGI_SCALING_STRETCH,
            SwapEffect: DXGI_SWAP_EFFECT_FLIP_SEQUENTIAL,
            AlphaMode: DXGI_ALPHA_MODE_PREMULTIPLIED,
            ..Default::default()
        };
        let swap: IDXGISwapChain1 = factory
            .CreateSwapChainForComposition(&device, &desc, None)
            .map_err(|e| format!("CreateSwapChainForComposition: {e}"))?;

        // Clear the back buffer to semi-transparent blue and present.
        let back: ID3D11Texture2D = swap.GetBuffer(0).map_err(|e| format!("GetBuffer: {e}"))?;
        let mut rtv: Option<ID3D11RenderTargetView> = None;
        device
            .CreateRenderTargetView(&back, None, Some(&mut rtv))
            .map_err(|e| format!("CreateRenderTargetView: {e}"))?;
        let rtv = rtv.ok_or("no rtv")?;
        // Premultiplied: rgb already scaled by alpha (0.5).
        context.ClearRenderTargetView(&rtv, &[0.0, 0.2, 0.5, 0.5]);
        swap.Present(1, 0).ok().map_err(|e| format!("Present: {e}"))?;

        // DirectComposition: target on the HWND (topmost) → visual → swapchain.
        let dcomp: IDCompositionDevice = DCompositionCreateDevice(&dxgi_device)
            .map_err(|e| format!("DCompositionCreateDevice: {e}"))?;
        let target: IDCompositionTarget = dcomp
            .CreateTargetForHwnd(hwnd, true)
            .map_err(|e| format!("CreateTargetForHwnd: {e}"))?;
        let visual: IDCompositionVisual =
            dcomp.CreateVisual().map_err(|e| format!("CreateVisual: {e}"))?;
        visual
            .SetContent(&swap)
            .map_err(|e| format!("SetContent: {e}"))?;
        target
            .SetRoot(&visual)
            .map_err(|e| format!("SetRoot: {e}"))?;
        dcomp.Commit().map_err(|e| format!("Commit: {e}"))?;

        *COMP.lock().unwrap() = Some(Comp {
            _device: device,
            _context: context,
            _swap: swap,
            _dcomp: dcomp,
            _target: target,
            _visual: visual,
        });
    }
    Ok(())
}
