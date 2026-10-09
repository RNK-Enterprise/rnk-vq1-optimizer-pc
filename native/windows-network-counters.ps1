param([switch]$json)

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public enum RnkTcpEstatsType { SynOpts = 0, Data = 1 }

[StructLayout(LayoutKind.Sequential)]
public struct RnkTcpOwnerPidRow
{
    public UInt32 State;
    public UInt32 LocalAddress;
    public UInt32 LocalPort;
    public UInt32 RemoteAddress;
    public UInt32 RemotePort;
    public UInt32 OwningPid;
}

[StructLayout(LayoutKind.Sequential)]
public struct RnkTcpRow
{
    public UInt32 State;
    public UInt32 LocalAddress;
    public UInt32 LocalPort;
    public UInt32 RemoteAddress;
    public UInt32 RemotePort;
}

[StructLayout(LayoutKind.Sequential)]
public struct RnkTcpDataRod
{
    public UInt64 DataBytesOut;
    public UInt64 DataSegsOut;
    public UInt64 DataBytesIn;
    public UInt64 DataSegsIn;
    public UInt64 SegsOut;
    public UInt64 SegsIn;
    public UInt32 SoftErrors;
    public UInt32 SoftErrorReason;
    public UInt32 SndUna;
    public UInt32 SndNxt;
    public UInt32 SndMax;
    public UInt64 ThruBytesAcked;
    public UInt32 RcvNxt;
    public UInt64 ThruBytesReceived;
}

public static class RnkWindowsNetworkCounters
{
    [DllImport("iphlpapi.dll", SetLastError = true)]
    private static extern UInt32 GetExtendedTcpTable(IntPtr table, ref Int32 size, Boolean order, Int32 family, Int32 tableClass, UInt32 reserved);

    [DllImport("iphlpapi.dll", SetLastError = true)]
    private static extern UInt32 SetPerTcpConnectionEStats(ref RnkTcpRow row, RnkTcpEstatsType type, Byte[] rw, UInt32 rwVersion, UInt32 rwSize, UInt32 offset);

    [DllImport("iphlpapi.dll", SetLastError = true)]
    private static extern UInt32 GetPerTcpConnectionEStats(ref RnkTcpRow row, RnkTcpEstatsType type, Byte[] rw, UInt32 rwVersion, UInt32 rwSize, Byte[] ros, UInt32 rosVersion, UInt32 rosSize, Byte[] rod, UInt32 rodVersion, UInt32 rodSize);

    public static List<Dictionary<String, Object>> Read()
    {
        const UInt32 BufferTooSmall = 122;
        const Int32 AfInet = 2;
        const Int32 TcpTableOwnerPidAll = 5;
        var result = new Dictionary<UInt32, Dictionary<String, Object>>();
        Int32 size = 0;
        UInt32 status = GetExtendedTcpTable(IntPtr.Zero, ref size, true, AfInet, TcpTableOwnerPidAll, 0);
        if (status != BufferTooSmall) throw new InvalidOperationException("GetExtendedTcpTable size query failed: " + status);
        IntPtr table = Marshal.AllocHGlobal(size);
        try
        {
            status = GetExtendedTcpTable(table, ref size, true, AfInet, TcpTableOwnerPidAll, 0);
            if (status != 0) throw new InvalidOperationException("GetExtendedTcpTable failed: " + status);
            Int32 count = Marshal.ReadInt32(table);
            IntPtr rowPointer = IntPtr.Add(table, 4);
            Int32 rowSize = Marshal.SizeOf<RnkTcpOwnerPidRow>();
            for (Int32 index = 0; index < count; index++)
            {
                var ownerRow = Marshal.PtrToStructure<RnkTcpOwnerPidRow>(rowPointer);
                rowPointer = IntPtr.Add(rowPointer, rowSize);
                var row = new RnkTcpRow { State = ownerRow.State, LocalAddress = ownerRow.LocalAddress, LocalPort = ownerRow.LocalPort, RemoteAddress = ownerRow.RemoteAddress, RemotePort = ownerRow.RemotePort };
                var rw = new Byte[] { 1 };
                if (SetPerTcpConnectionEStats(ref row, RnkTcpEstatsType.Data, rw, 0, 1, 0) != 0) continue;
                var rod = new Byte[Marshal.SizeOf<RnkTcpDataRod>()];
                if (GetPerTcpConnectionEStats(ref row, RnkTcpEstatsType.Data, rw, 0, 1, null, 0, 0, rod, 0, (UInt32)rod.Length) != 0 || rw[0] == 0) continue;
                var data = new RnkTcpDataRod();
                GCHandle handle = GCHandle.Alloc(rod, GCHandleType.Pinned);
                try { data = Marshal.PtrToStructure<RnkTcpDataRod>(handle.AddrOfPinnedObject()); }
                finally { handle.Free(); }
                if (!result.TryGetValue(ownerRow.OwningPid, out var aggregate))
                {
                    aggregate = new Dictionary<String, Object> { ["Pid"] = ownerRow.OwningPid, ["BytesReceived"] = (UInt64)0, ["BytesSent"] = (UInt64)0, ["Protocol"] = "tcp", ["AddressFamily"] = "ipv4" };
                    result.Add(ownerRow.OwningPid, aggregate);
                }
                aggregate["BytesReceived"] = (UInt64)aggregate["BytesReceived"] + data.DataBytesIn;
                aggregate["BytesSent"] = (UInt64)aggregate["BytesSent"] + data.DataBytesOut;
            }
        }
        finally { Marshal.FreeHGlobal(table); }
        return new List<Dictionary<String, Object>>(result.Values);
    }
}
'@

try {
    [Console]::OutputEncoding = [Text.Encoding]::UTF8
    [RnkWindowsNetworkCounters]::Read() | ConvertTo-Json -Compress
} catch {
    @{ state = 'unavailable'; reason = $_.Exception.Message } | ConvertTo-Json -Compress
    exit 1
}
